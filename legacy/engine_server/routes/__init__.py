from routes.analysis import router as analysis_router
from routes.best_move import router as best_move_router
from routes.cloud_eval import router as cloud_eval_router
from routes.game_analysis import router as game_analysis_router
from routes.health import router as health_router
from routes.stream_analysis import router as stream_analysis_router

routers = [
    health_router,
    best_move_router,
    cloud_eval_router,
    analysis_router,
    game_analysis_router,
    stream_analysis_router,
]
