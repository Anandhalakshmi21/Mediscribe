from openai import OpenAI
import os
from dotenv import load_dotenv

load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

def generate_reasoning(structured_input):

    prompt = f"""
You are a clinical decision support assistant.

Patient Data:
{structured_input}

Return JSON:
{{
  "differential_diagnosis": [],
  "clinical_reasoning": "",
  "recommended_tests": [],
  "patient_summary": ""
}}
"""

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2
    )

    return response.choices[0].message.content
