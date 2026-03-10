from fastapi import APIRouter
from app.services.fusion_service import build_context
from app.services.llm_service import generate_reasoning

router = APIRouter(prefix="/reasoning", tags=["Reasoning"])

session_transcript = ""

@router.post("/generate")
async def generate_report():

    structured_data = build_context(session_transcript)
    result = generate_reasoning(structured_data)

    return result
