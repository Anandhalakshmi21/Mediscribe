from fastapi import APIRouter, UploadFile, File
from app.services.whisper_service import transcribe_chunk

router = APIRouter(prefix="/asr", tags=["ASR"])

session_transcript = ""

@router.post("/stream")
async def stream_audio(file: UploadFile = File(...)):
    global session_transcript

    audio_bytes = await file.read()
    text = transcribe_chunk(audio_bytes)

    session_transcript += " " + text

    return {"text": text}
