from app.routes.user_profiles import router as user_profiles_router
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes.sources import router as sources_router
from app.routes.stories import router as stories_router

app = FastAPI(title="Event News API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://octiq-alpha.vercel.app",
        
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sources_router)
app.include_router(stories_router)
app.include_router(user_profiles_router)

@app.get("/")
def root():
    return {"message": "Event News API is running"}



