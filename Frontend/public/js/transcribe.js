let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let fullTranscript = "";

const startBtn = document.getElementById("startMic");
const pauseBtn = document.getElementById("pauseMic");
const stopBtn = document.getElementById("stopMic");
const outputDiv = document.getElementById("transcriptionOutput");

// 🔴 Replace with your ngrok URL
const API_URL = "https://helene-overdogmatic-seth.ngrok-free.dev/transcribe";
// ⚠️ WARNING: The Gemini API key will be exposed in client-side code.
// Only use this for testing. Replace with your key or add a backend proxy for production.
const GEMINI_API_KEY = "AIzaSyDstac80iUPuDwuN9nTzb8Ow95I9Pbu7pg";

// ----------------------------
// START RECORDING
// ----------------------------
// async function startRecording() {
//     try {
//         const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

//         // mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
//         mediaRecorder = new MediaRecorder(stream);

//         mediaRecorder.ondataavailable = event => {
//             if (event.data.size > 0) {
//                 audioChunks.push(event.data);
//             }
//         };

//         mediaRecorder.onstop = async () => {
//             const blob = new Blob(audioChunks, { type: "audio/wav" });
//             audioChunks = [];

//             await sendAudioChunk(blob);

//             // After final chunk sent, call backend LLM to fix/clean the live transcript
//             try {
//                 // await callFixTranscript();
//             } catch (e) {
//                 console.error('Error calling fix transcript on stop:', e);
//             }
//         };

//         mediaRecorder.start();
//         isRecording = true;

//         // UI updates
//         startBtn.style.display = "none";
//         pauseBtn.style.display = "inline-block";
//         stopBtn.style.display = "inline-block";

//         outputDiv.innerHTML = `<p class="status-message active">Recording...</p>`;

//         // Send chunk every 4 seconds (REST pseudo-streaming)
//         setInterval(() => {
//             if (isRecording) {
//                 mediaRecorder.stop();
//                 mediaRecorder.start();
//             }
//         }, 2000);

//     } catch (err) {
//         console.error("Mic access error:", err);
//         alert("Microphone access denied.");
//     }
// }

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        // ✅ Explicitly record as webm (opus)
        mediaRecorder = new MediaRecorder(stream, {
            mimeType: "audio/webm;codecs=opus"
        });

        mediaRecorder.ondataavailable = event => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = async () => {
            const blob = new Blob(audioChunks, {
                type: "audio/webm"
            });

            audioChunks = [];

            await sendAudioChunk(blob);
        };

        mediaRecorder.start();
        isRecording = true;

        // UI updates
        startBtn.style.display = "none";
        pauseBtn.style.display = "inline-block";
        stopBtn.style.display = "inline-block";

        outputDiv.innerHTML = `<p class="status-message active">Recording...</p>`;

        // ✅ Save interval reference (avoid duplicates)
        chunkInterval = setInterval(() => {
            if (isRecording && mediaRecorder.state === "recording") {
                mediaRecorder.stop();
                mediaRecorder.start();
            }
        }, 2000);

    } catch (err) {
        console.error("Mic access error:", err);
        alert("Microphone access denied.");
    }
}

// ----------------------------
// PAUSE RECORDING
// ----------------------------
function pauseRecording() {
    if (mediaRecorder && isRecording) {
        mediaRecorder.pause();
        
        // UI update
        pauseBtn.textContent = "Resume";
        
        outputDiv.innerHTML += `<p class="status-message paused">Paused...</p>`;

        // Call backend LLM to fix/clean the live transcript for an ortho doctor
        try {
            // callFixTranscript();
        } catch (e) {
            console.error('Error calling fix transcript on pause:', e);
        }
    }
}

// ----------------------------
// STOP RECORDING
// ----------------------------
// function stopRecording() {
//     if (mediaRecorder) {
//         isRecording = false;
//         mediaRecorder.stop();

//         startBtn.style.display = "inline-block";
//         pauseBtn.style.display = "none";
//         stopBtn.style.display = "none";
//     }
// }

function stopRecording() {
    if (mediaRecorder) {
        isRecording = false;

        clearInterval(chunkInterval); // ✅ prevent multiple intervals

        if (mediaRecorder.state !== "inactive") {
            mediaRecorder.stop();
        }

        // UI updates
        startBtn.style.display = "inline-block";
        pauseBtn.style.display = "none";
        stopBtn.style.display = "none";
    }
}


// ----------------------------
// SEND AUDIO TO BACKEND
// ----------------------------
// async function sendAudioChunk(blob) {
//     try {
//         const formData = new FormData();
//         formData.append("file", blob, "chunk.webm");

//         const response = await fetch(API_URL, {
//             method: "POST",
//             body: formData
//         });

//         const data = await response.json();

//         if (data.transcription) {
//             // 🔹 Remove non-English characters
//             const englishOnly = data.transcription.replace(
//                 /[^a-zA-Z0-9.,!?'"()\-\s]/g,
//                 ""
//             );

//             fullTranscript += " " + englishOnly;

//             outputDiv.innerHTML = `
//                 <div class="live-text">
//                     ${fullTranscript}
//                 </div>
//             `;
//         }

//     } catch (error) {
//         console.error("Upload error:", error);
//     }
// }

async function sendAudioChunk(blob) {
    try {
        const formData = new FormData();

        // ✅ filename matches format
        formData.append("file", blob, "chunk.webm");

        const response = await fetch(API_URL, {
            method: "POST",
            body: formData
        });

        const data = await response.json();

        if (data.transcription) {
            const englishOnly = data.transcription.replace(
                /[^a-zA-Z0-9.,!?'"()\-\s]/g,
                ""
            );

            fullTranscript += " " + englishOnly;

            document.getElementById("transcriptionOutput").innerHTML =
                `<div class="live-text">${fullTranscript}</div>`;
        }

    } catch (error) {
        console.error("Upload error:", error);
    }
}


/**
 * Calls backend LLM (Gemini proxy) to fix and format the current live transcript
 * into notes an orthopaedic doctor would use.
 */
async function callFixTranscript() {
    const liveEl = document.querySelector('.live-text');
    if (!liveEl) return;
    const text = liveEl.innerText.trim();
    if (!text) return;

    // Show inline status
    const statusP = document.createElement('p');
    statusP.className = 'status-message active';
    statusP.textContent = '🛠️ Fixing transcript for ortho doctor...';
    outputDiv.appendChild(statusP);

    try {
        const systemInstruction = "You are an orthopaedic doctor. Fix, clean, and format the transcript into clinical notes an orthopaedic surgeon would use. Use precise medical terminology, correct grammar. Return only the fixed notes.";

        const promptText = `SYSTEM INSTRUCTION:\n${systemInstruction}\n\nTRANSCRIPT:\n${text}
        DO NOT ADD ANYTHING OTHER THAN THE FIXED TRANSCRIPT. DO NOT RETURN ANY EXPLANATIONS. ONLY RETURN THE FIXED TRANSCRIPT AS THE OUTPUT.
        `;

        const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';

        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // quickstart uses x-goog-api-key header
                'x-goog-api-key': GEMINI_API_KEY
            },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            { text: promptText }
                        ]
                    }
                ]
            })
        });

        if (resp.ok) {
            const j = await resp.json();

            // Try multiple possible response shapes
            let fixed = '';
            if (j.candidates && j.candidates.length) {
                fixed = j.candidates[0].output || (j.candidates[0].content && j.candidates[0].content.map(c => c.text).join('')) || '';
            }
            if (!fixed && j.output && j.output.length) {
                fixed = j.output.map(o => (o.content || []).map(c => c.text || '').join('')).join('\n');
            }
            if (!fixed) fixed = j.outputText || j.result || j.text || j.fixed_transcript || '';

            if (fixed) {
                fullTranscript = fixed;
                outputDiv.innerHTML = `<div class="live-text">${fixed}</div>`;
            }
        } else {
            console.error('Gemini API responded with error', resp.status, resp.statusText);
        }
    } catch (err) {
        console.error('callFixTranscript error:', err);
    } finally {
        const s = outputDiv.querySelector('.status-message.active');
        if (s) s.remove();
    }
}
