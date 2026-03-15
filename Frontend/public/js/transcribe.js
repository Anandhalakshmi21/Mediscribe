let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let fullTranscript = "";
let isEditMode = false;
let chunkInterval;
let currentSessionId = null;
let pendingChunkPromise = null;
let analysisInFlight = false;
let analysisTimer = null;
let lastAnalysisAt = 0;
let lastAnalyzedTranscript = "";

const MIN_ANALYZE_INTERVAL_MS = 5000;
const ANALYZE_DEBOUNCE_MS = 800;

const startBtn = document.getElementById("startMic");
const pauseBtn = document.getElementById("pauseMic");
const stopBtn = document.getElementById("stopMic");
const outputDiv = document.getElementById("transcriptionOutput");

// 🔴 Replace with your ngrok URL


const API_URL =  "https://helene-overdogmatic-seth.ngrok-free.dev/transcribe";

function setPredictionStatus(text) {
    const status = document.querySelector("#predictionSidebar .status-message");
    if (status) status.textContent = text == null ? "" : String(text);
}

function extractPredictionText(payload) {
    if (!payload) return null;

    if (typeof payload.prediction === "string") return payload.prediction;
    if (typeof payload.predictions === "string") return payload.predictions;

    const analysis = payload.analysis;
    if (typeof analysis === "string") return analysis;
    if (analysis && typeof analysis.prediction === "string") return analysis.prediction;
    if (analysis && typeof analysis.predictions === "string") return analysis.predictions;

    return null;
}

function queueTranscriptAnalysis() {
    if (analysisTimer) window.clearTimeout(analysisTimer);
    analysisTimer = window.setTimeout(() => {
        analyzeTranscript().catch(err => console.warn("Analyze failed:", err));
    }, ANALYZE_DEBOUNCE_MS);
}

async function saveSessionAnalysis(sessionId, analysisPayload) {
    if (!sessionId) return;

    try {
        await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/analysis`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ analysis: analysisPayload })
        });
    } catch (err) {
        console.warn("Failed to persist analysis:", err);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const status = document.querySelector("#predictionSidebar .status-message");
    if (status && !status.textContent.trim()) {
        status.textContent = "Waiting for input...";
    }
});
// ⚠️ WARNING: The Gemini API key will be exposed in client-side code.
// Only use this for testing. Replace with your key or add a backend proxy for production.

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
        await ensureConsultationSession();
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
            pendingChunkPromise = sendAudioChunk(blob);
            try {
                await pendingChunkPromise;
            } finally {
                pendingChunkPromise = null;
            }
        };

        // UI updates
        startBtn.style.display = "none";
        pauseBtn.style.display = "inline-block";
        stopBtn.style.display = "inline-block";

        // ✅ UI Updates: Sidebar (Slide in)
        const sidebar = document.getElementById("predictionSidebar");
        if (sidebar) {
            sidebar.classList.add("open"); 
            sidebar.classList.add("active"); // Keep active if you use it for other styles
        }

        mediaRecorder.start();
        isRecording = true;

        outputDiv.innerHTML = `<p class="status-message active">Recording...</p>`;

        // ✅ Save interval reference (avoid duplicates)
        chunkInterval = setInterval(() => {
            if (isRecording && mediaRecorder.state === "recording") {
                mediaRecorder.stop();
                mediaRecorder.start();
            }
        }, 4000);

    } catch (err) {
        console.error("Mic access error:", err);
        alert(err?.message || "Microphone access denied.");
    }
}

async function ensureConsultationSession() {
    if (currentSessionId) return currentSessionId;

    const patientId = window.currentPatientId || "UNKNOWN";
    if (patientId === "UNKNOWN") {
        throw new Error("No patient selected for this consultation.");
    }
    const resp = await fetch("/api/sessions/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId })
    });

    if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`Failed to start session (${resp.status}): ${text}`);
    }

    const data = await resp.json();
    currentSessionId = data.sessionId;
    return currentSessionId;
}

async function saveConsultationRecord(patientId, opts = {}) {
    const quiet = Boolean(opts.quiet);
    const liveDiv = document.querySelector(".live-text");
    const transcript = (liveDiv ? liveDiv.innerText : fullTranscript || "").trim();

    if (!transcript) {
        if (!quiet) alert("Nothing to save yet.");
        return;
    }

    await ensureConsultationSession();

    const resp = await fetch(`/api/sessions/${encodeURIComponent(currentSessionId)}/transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, status: "Processing" })
    });

    if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`Save failed (${resp.status}): ${text}`);
    }

    if (!quiet) alert("Session saved.");
}

async function endSessionPrompt() {
    const patientId = window.currentPatientId || "UNKNOWN";
    const confirmed = confirm("End this consultation session? This will save and complete the session.");
    if (!confirmed) return;

    try {
        if (isRecording) {
            stopRecording();
            if (pendingChunkPromise) {
                await Promise.race([
                    pendingChunkPromise,
                    new Promise(resolve => setTimeout(resolve, 8000))
                ]);
            }
        }

        await saveConsultationRecord(patientId, { quiet: true });

        if (currentSessionId) {
            await fetch(`/api/sessions/${encodeURIComponent(currentSessionId)}/end`, { method: "POST" });
        }

        await fetch("/complete-appointment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ patientId })
        }).catch(() => null);

        window.location.href = "/home/doctor";
    } catch (err) {
        console.error(err);
        alert("Failed to end session. Please try again.");
    }
}

// ----------------------------
// PAUSE RECORDING
// ----------------------------
function pauseRecording() {
    if (!mediaRecorder) return;

    if (mediaRecorder.state === "recording") {
        mediaRecorder.pause();
        pauseBtn.innerHTML = `<span class="material-icons">play_arrow</span>`;
    } else if (mediaRecorder.state === "paused") {
        mediaRecorder.resume();
        pauseBtn.innerHTML = `<span class="material-icons">pause</span>`;
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

         // ✅ Enable Edit button after session ends
        const editBtn = document.getElementById("editToggleBtn");
        editBtn.disabled = false;

        // ✅ Automatically prepare transcript for editing
        let liveDiv = document.querySelector(".live-text");

        if (!liveDiv) {
            outputDiv.innerHTML = `<div class="live-text">${fullTranscript}</div>`;
            liveDiv = document.querySelector(".live-text");
        }

        liveDiv.contentEditable = "true";
        liveDiv.classList.add("editable-mode");
        liveDiv.focus();

        editBtn.innerHTML = `
            <span class="material-icons">check_circle</span> Save Changes
        `;

        isEditMode = true;
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
        formData.append("file", blob, "audio.webm");

        const response = await fetch(API_URL, {
            method: "POST",
            body: formData
        });

        const data = await response.json();

        console.log("TRANSCRIBE RESPONSE:", data);

        if (!data.transcription) {
            console.warn("No transcription returned");
            return;
        }

        const englishOnly = data.transcription.replace(
            /[^a-zA-Z0-9.,!?'"()\-\s]/g,
            ""
        );

        fullTranscript += " " + englishOnly;

        let liveDiv = document.querySelector(".live-text");

        if (!liveDiv) {
            outputDiv.innerHTML = `<div class="live-text"></div>`;
            liveDiv = document.querySelector(".live-text");
        }

        liveDiv.innerText = fullTranscript;

        // Mirror the latest prediction text into the sidebar in near real-time.
        queueTranscriptAnalysis();

    } catch (error) {
        console.error("Upload error:", error);
    }
}

function updatePredictionSidebar(data) {

    console.log("Prediction data:", data);

    const diseaseList = document.getElementById("diseasePrediction");
    const medicationList = document.getElementById("medicationSuggestion");
    const testList = document.getElementById("testSuggestion");

    if (!diseaseList || !medicationList || !testList) return;

    diseaseList.innerHTML = "";
    medicationList.innerHTML = "";
    testList.innerHTML = "";

    // get predictions safely
    const predictions = data?.analysis?.predictions || [];

    if (predictions.length === 0) {
        setPredictionStatus("No prediction available");
        return;
    }

    predictions.forEach(pred => {

        if (pred.disease) {
            const li = document.createElement("li");
            li.textContent = pred.disease;
            diseaseList.appendChild(li);
        }

        if (pred.medication) {
            const li = document.createElement("li");
            li.textContent = pred.medication;
            medicationList.appendChild(li);
        }

        if (pred.test) {
            const li = document.createElement("li");
            li.textContent = pred.test;
            testList.appendChild(li);
        }

    });

    setPredictionStatus("Prediction ready");
}

async function analyzeTranscript(transcriptOverride) {
    if (analysisInFlight) return;

    const liveEl = document.querySelector(".live-text");
    const transcript = (typeof transcriptOverride === "string" ? transcriptOverride : (liveEl ? liveEl.innerText : "")).trim();

    if (!transcript) {
        setPredictionStatus("Waiting for input...");
        return;
    }

    const now = Date.now();
    if (now - lastAnalysisAt < MIN_ANALYZE_INTERVAL_MS) {
        queueTranscriptAnalysis();
        return;
    }

    if (transcript === lastAnalyzedTranscript) return;

    analysisInFlight = true;
    lastAnalysisAt = now;

    setPredictionStatus("Analyzing...");

    try {
        const response = await fetch("/analyze-transcript", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ transcript })
        });

        if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw new Error(`Analyze failed (${response.status}): ${text}`);
        }

        const data = await response.json();

        console.log("Prediction received:", data);

        lastAnalyzedTranscript = transcript;
        updatePredictionSidebar(data);
        await saveSessionAnalysis(currentSessionId, data);
    } catch (err) {
        console.error(err);
        setPredictionStatus("Waiting for input...");
    } finally {
        analysisInFlight = false;
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
                'x-goog-api-key': `${GEMINI_API_KEY}`
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

function openUploadFromDeviceModal() {
    document.getElementById("uploadDeviceModal").style.display = "block";
}

async function openQrModal() {
    const patientId = window.currentPatientId || 'UNKNOWN';
    document.getElementById('qrCodeModal').style.display = 'block';
    const display = document.getElementById('qrCodeDisplay');
    display.innerHTML = '<p>Generating QR...</p>';

    try {
        const resp = await fetch(`/generate-qr?patientId=${encodeURIComponent(patientId)}`);
        if (!resp.ok) throw new Error('QR generation failed');
        const j = await resp.json();
        display.innerHTML = `\n            <img src="${j.dataUrl}" alt="QR Code" class="qr-code-img">\n            <p class="qr-link">Unique Link: <code>${j.link}</code></p>\n        `;
    } catch (err) {
        console.error('openQrModal error:', err);
        display.innerHTML = '<p>Error generating QR code.</p>';
    }
}

async function uploadMedicalReport() {

    const fileInput = document.getElementById("medicalFileInput");
    const file = fileInput.files[0];

    if (!file) {
        alert("Please select a file.");
        return;
    }

    const patientId = window.currentPatientId || 'UNKNOWN';

    const formData = new FormData();
    formData.append("file", file);
    formData.append("patientId", patientId);

    const summaryContainer = document.getElementById("reportSummaryOutput");
    summaryContainer.innerHTML = "<p>Analyzing report... Please wait.</p>";

    try {
        const response = await fetch("/upload-report", {
            method: "POST",
            body: formData
        });

        const data = await response.json();

        summaryContainer.innerHTML = "";

        if (data.tests && data.tests.length > 0) {
            data.tests.forEach(test => {
                const row = document.createElement("p");
                row.innerHTML = `<strong>${test.testName}:</strong> ${test.value} ${test.unit}`;
                summaryContainer.appendChild(row);
            });
        } else {
            summaryContainer.innerHTML = "No tests detected.";
        }

    } catch (error) {
        summaryContainer.innerHTML = "<p>Error analyzing report.</p>";
    }
}


function toggleInlineEdit() {
    const editBtn = document.getElementById("editToggleBtn");
    const liveDiv = document.querySelector(".live-text");

    if (!liveDiv) return;

    if (isEditMode) {

    // Save edited transcript
    fullTranscript = liveDiv.innerText;

    liveDiv.contentEditable = "false";
    liveDiv.classList.remove("editable-mode");

    editBtn.innerHTML = `
        <span class="material-icons">edit</span> Edit Notes
    `;

    isEditMode = false;

    // ✅ SEND EDITED TRANSCRIPT TO AI
    analyzeTranscript();

    } else {
        // Re-open editing if needed
        liveDiv.contentEditable = "true";
        liveDiv.classList.add("editable-mode");
        liveDiv.focus();

        editBtn.innerHTML = `
            <span class="material-icons">check_circle</span> Save Changes
        `;

        isEditMode = true;
    }
}

function saveEditedNotes() {
    const textarea = document.getElementById("editableNotes");
    const text = (textarea?.value || "").trim();
    if (!text) return;
    fullTranscript = text;
    outputDiv.innerHTML = `<div class="live-text">${text}</div>`;
    closeModal("editModal");
}

function finalizeNextAppointment() {
    closeModal("nextAppointmentModal");
}
