Mediscribe
An AI-powered clinical documentation tool that transforms medical conversations into structured SOAP reports.

🛠 Tech Stack
AI/ML: OpenAI Whisper, WhisperX (Transcription), spaCy (NLP/NER), Llama-3-8b (Clinical Analysis)
Backend: Node.js, Python (FastAPI/Flask)
Frontend: React.js, JavaScript, CSS3
Database: MongoDB / PostgreSQL
Infrastructure: Google Colab, Google Drive API, Git LFS

Installation & Setup

Prerequisites
Node.js (v18+)
Python 3.9+
FFmpeg (required for Whisper audio processing)

Clone the Repository
git clone https://github.com/Anandhalakshmi21/Mediscribe.git
cd Mediscribe

Backend Setup
cd backend
pip install -r requirements.txt
python main.py

Frontend Setup
cd frontend
npm install
npm run dev

Features
High-Accuracy Transcription: Utilizes fine-tuned Whisper models on medical datasets (PriMock57) for precise clinical recognition.
Automated SOAP Generation: Converts raw transcripts into structured Subjective, Objective, Assessment, and Plan (SOAP) reports.
Medical Entity Extraction: Automatically identifies symptoms, medications, and diagnoses using advanced NLP.
Role-Based Access Control (RBAC): Secure dashboard for Admins to manage Doctors and Assistants.
Real-time Analysis: Integrated with multiple LLMs (Llama-3, DeepSeek, Gemini) for diagnostic assistance.
