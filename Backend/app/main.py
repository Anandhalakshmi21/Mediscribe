from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import asr, reasoning

app = FastAPI(title="MediScribe AI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # your frontend
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(asr.router)
app.include_router(reasoning.router)
