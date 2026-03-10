from pydantic import BaseSettings

class Settings(BaseSettings):
    WHISPER_API_URL: str = "https://helene-overdogmatic-seth.ngrok-free.dev/transcribe/"

settings = Settings()
