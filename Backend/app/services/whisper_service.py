import requests
import tempfile
import os
from app.config import settings

COLAB_API_URL = settings.WHISPER_API_URL  

def transcribe_audio(file_path: str):
    try:
        with open(file_path, "rb") as f:
            files = {"files": f}
            response = requests.post(COLAB_API_URL, files=files)

        if response.status_code == 200:
            return response.json().get("text")
        else:
            raise Exception(f"Whisper API error: {response.text}")

    except Exception as e:
        raise Exception(f"Failed to connect to Whisper API: {str(e)}")


def transcribe_chunk(audio_bytes: bytes) -> str:
    """
    Transcribes audio chunk from bytes.
    Converts byte data to a temporary file and sends to Whisper API.
    """
    try:
        # Create a temporary file to store the audio chunk
        with tempfile.NamedTemporaryFile(delete=False, suffix='.webm') as tmp_file:
            tmp_file.write(audio_bytes)
            tmp_file_path = tmp_file.name
        
        try:
            # Send to Whisper API
            with open(tmp_file_path, 'rb') as f:
                files = {"files": f}
                response = requests.post(COLAB_API_URL, files=files)

            if response.status_code == 200:
                return response.json().get("text", "")
            else:
                raise Exception(f"Whisper API error: {response.text}")
        
        finally:
            # Clean up temporary file
            if os.path.exists(tmp_file_path):
                os.remove(tmp_file_path)
    
    except Exception as e:
        print(f"Error transcribing chunk: {str(e)}")
        return ""

