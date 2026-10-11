from fastapi import FastAPI

from hack_dbab4d08_ai_job_hunter.data_loader import load_contractors
from hack_dbab4d08_ai_job_hunter.diagnostics import (
    build_no_matches_message,
    get_rejection_stats,
)
from hack_dbab4d08_ai_job_hunter.explanations import build_explanation
from hack_dbab4d08_ai_job_hunter.filters import (
    category_exists_in_city,
    filter_contractors,
)
from hack_dbab4d08_ai_job_hunter.ranking import rank_contractors
from hack_dbab4d08_ai_job_hunter.schemas import (
    RecommendationRequest,
    RecommendationResponse,
)


from pathlib import Path
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles



app = FastAPI()

STATIC_DIR = Path(__file__).resolve().parent / "static"

app.mount(
    "/static",
    StaticFiles(directory=STATIC_DIR),
    name="static"
)


@app.get("/", include_in_schema=False)
def home():
    return FileResponse(STATIC_DIR / "index.html")

contractors = load_contractors()

@app.get("/health")
def health():
    return {
        "status": "ok",
        "contractors_loaded": len(contractors),
    }

@app.post(
    "/recommend",
    response_model=RecommendationResponse,
)
def recommend(request: RecommendationRequest):
    category_exists = category_exists_in_city(
        contractors,
        request,
    )

    if not category_exists:
        return {
            "status": "category_not_found",
            "count": 0,
            "message": (
                f"В городе {request.city} нет подрядчиков "
                f"категории «{request.category}»."
            ),
            "contractors": [],
        }

    filtered = filter_contractors(
        contractors,
        request,
    )

    if filtered.empty:
        stats = get_rejection_stats(
            contractors,
            request,
        )

        return {
            "status": "no_matches",
            "count": 0,
            "message": build_no_matches_message(stats),
            "rejection_stats": stats,
            "contractors": [],
        }

    ranked = rank_contractors(
        filtered,
        request,
    )

    top_contractors = ranked.head(3).copy()

    top_contractors["score"] = (
        top_contractors["score"].round(2)
    )

    top_contractors["semantic_score"] = (
        top_contractors["semantic_score"].round(3)
    )

    top_contractors["explanation"] = (
        top_contractors.apply(
            lambda contractor: build_explanation(
                contractor,
                request,
            ),
            axis=1,
        )
    )

    # Категория, по которой пользователь выполнял поиск
    top_contractors["category"] = request.category

    # Переименовываем anon_name -> name для API
    top_contractors = top_contractors.rename(
        columns={
            "anon_name": "name",
        }
    )

    return {
        "status": "success",
        "count": len(top_contractors),
        "contractors": top_contractors[
            [
                "id",
                "name",
                "category",
                "city",
                "price_from_kzt",
                "languages",
                "score",
                "semantic_score",
                "explanation",
            ]
        ].to_dict(orient="records"),
    }
@app.get(
    "/",
    response_class=FileResponse,
    include_in_schema=False,
)
def frontend() -> FileResponse:
    html_path = (
        Path(__file__).resolve().parents[2]
        / "static"
        / "index.html"
    )

    return FileResponse(
        html_path,
        media_type="text/html",
        headers={"Cache-Control": "no-store"},
    )