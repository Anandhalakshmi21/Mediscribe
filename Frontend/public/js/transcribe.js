let isRecording = false;
let isPaused = false;
const outputDiv = document.getElementById('transcriptionOutput');
const startBtn = document.getElementById('startMic');
const pauseBtn = document.getElementById('pauseMic');
const stopBtn = document.getElementById('stopMic');
const sidebar = document.getElementById('predictionSidebar');
const setNextApptBtn = document.getElementById('setNextApptBtn');
let transcriptionInterval;

/**
 * Initializes the recording session.
 */
function startRecording() {
    if (isRecording) {
        return; // Already recording
    }
    
    isRecording = true;
    isPaused = false;
    console.log("Recording started...");

    // Update UI
    startBtn.style.display = 'none';
    pauseBtn.style.display = 'flex';
    stopBtn.style.display = 'flex';
    sidebar.classList.add('open');
    setNextApptBtn.style.display = 'none';

    outputDiv.innerHTML = '<p class="status-message active">Recording... Please begin consultation.</p>';
    
    // Simulate real-time transcription update
    transcriptionInterval = setInterval(simulateTranscription, 3000);
}

/**
 * Pauses the recording session.
 */
function pauseRecording() {
    if (!isRecording || isPaused) {
        return;
    }
    isPaused = true;
    clearInterval(transcriptionInterval);
    console.log("Recording paused.");
    outputDiv.innerHTML += '<p class="status-message active">[Recording Paused]</p>';
    
    // Update UI: Pause button icon might change or remain pause depending on design choice
    pauseBtn.querySelector('.material-icons').textContent = 'play_arrow';
}

/**
 * Resumes the recording session.
 */
function resumeRecording() {
    if (!isRecording || !isPaused) {
        return;
    }
    isPaused = false;
    console.log("Recording resumed.");
    outputDiv.innerHTML += '<p class="status-message active">[Recording Resumed]</p>';
    
    // Update UI
    pauseBtn.querySelector('.material-icons').textContent = 'pause';
    transcriptionInterval = setInterval(simulateTranscription, 3000);
}

/**
 * Stops the recording session, finalizing the transcript.
 */
function stopRecording() {
    if (!isRecording) {
        return;
    }
    
    isRecording = false;
    isPaused = false;
    clearInterval(transcriptionInterval);
    console.log("Recording stopped. Finalizing transcript and running prediction analysis.");

    // Update UI
    startBtn.style.display = 'flex';
    pauseBtn.style.display = 'none';
    stopBtn.style.display = 'none';
    sidebar.classList.remove('open');
    setNextApptBtn.style.display = 'block';

    outputDiv.innerHTML += '<p class="status-message inactive">--- END OF CONSULTATION ---</p>';

    // In a real app, send final transcript to DB and AI for final predictions
    
    // Enable "Set Next Appointment" button
    document.getElementById('setNextApptBtn').style.display = 'block';
}

/**
 * Simulates real-time transcription updates.
 */
function simulateTranscription() {
    const transcriptions = [
        "Doctor: So, tell me about your symptoms. How long have they persisted?",
        "Patient: It started about three days ago. A persistent, dry cough and I feel very weak.",
        "Doctor: I see. Have you taken your temperature recently? Any history of this illness?",
        "Patient: My temperature was 100.4°F this morning. No, this is new for me.",
        "Doctor: Alright. We will start with a brief examination and then discuss potential tests."
    ];
    
    const newText = transcriptions[Math.floor(Math.random() * transcriptions.length)];
    
    // Append new text, remove status message if present
    const status = outputDiv.querySelector('.status-message.active');
    if (status) {
        outputDiv.removeChild(status);
    }
    
    outputDiv.innerHTML += `<p>${newText}</p>`;
    // Scroll to the bottom
    outputDiv.scrollTop = outputDiv.scrollHeight; 
}

/**
 * Handles toggling the visibility of the Upload drop-down menu.
 */
function toggleUploadDropdown() {
    const dropdownContent = document.getElementById("uploadDropdownContent");
    if (dropdownContent.style.display === "block") {
        dropdownContent.style.display = "none";
    } else {
        dropdownContent.style.display = "block";
    }
}

document.addEventListener('click', (event) => {
    const dropdown = document.querySelector('.dropdown');
    const dropdownContent = document.getElementById("uploadDropdownContent");
    
    // Check if the dropdown content exists and if the click was NOT on the dropdown button itself
    if (dropdownContent && dropdown) {
        const isClickInsideDropdown = dropdown.contains(event.target);

        if (!isClickInsideDropdown && dropdownContent.style.display === 'block') {
            // Close the dropdown
            dropdownContent.style.display = 'none';
        }
    }
});

/**
 * Handles file selection from the user's system.
 * @param {Event} event - The file input change event.
 */
function handleFileUpload(event) {
    const file = event.target.files[0];
    if (file) {
        console.log(`File selected: ${file.name}. Ready to upload and associate with patient.`);
        alert(`File "${file.name}" uploaded and associated with patient.`);
        // In a real app: upload file via AJAX, get URL, store in DB.
    }
}

/**
 * Shows the modal for the patient QR code upload option.
 */
function showQrModal() {
    // In a real app: Generate a unique, time-sensitive QR code linking to a file upload portal
    document.getElementById('qrCodeModal').style.display = 'block';
    console.log('QR Code Modal displayed.');
    toggleUploadMenu(); // Close the dropdown menu
}

/**
 * Shows the modal for editing the consultation notes/transcript.
 */
function openEditModal() {
    // Populate the modal with the current transcript content
    const fullTranscript = Array.from(outputDiv.querySelectorAll('p')).map(p => p.textContent).join('\n');
    document.getElementById('editableNotes').value = fullTranscript;
    document.getElementById('editModal').style.display = 'block';
}

/**
 * Saves the edited notes back to the main transcript and DB (simulated).
 */
function saveEditedNotes() {
    const editedText = document.getElementById('editableNotes').value;
    
    // Update the main transcription area
    outputDiv.innerHTML = editedText.split('\n').map(line => `<p>${line}</p>`).join('');
    outputDiv.innerHTML += '<p class="status-message inactive">[Notes edited and saved]</p>';
    
    // In a real app: Send editedText to the backend for storage
    console.log("Edited notes saved successfully.");
    closeModal('editModal');
}

/**
 * Prompts the doctor before ending the entire session.
 */
function endSessionPrompt() {
    if (confirm('Are you sure you want to end the consultation? All unsaved work will be lost.')) {
        stopRecording();
        console.log("Session ended by user action. Redirecting to Appointment List.");
        // After ending, typically redirect to the Appointment list or a summary page
        window.location.href = '/appointment'; 
    }
}

/**
 * Shows the modal to set the next appointment date (after consultation is stopped).
 */
function showNextAppointmentSelector() {
    document.getElementById('nextAppointmentModal').style.display = 'block';
}

/**
 * Finalizes the follow-up appointment setting.
 */
function finalizeNextAppointment() {
    const date = document.getElementById('followUpDateInput').value;
    if (date) {
        console.log(`Next appointment set for ${date}`);
        alert(`Follow-up appointment scheduled for ${date}.`);
        closeModal('nextAppointmentModal');
        // Redirect back to appointment page
        window.location.href = '/appointment'; 
    } else {
        alert('Please select a date.');
    }
}

function saveConsultationRecord(patientId) {
    // 1. Get the final transcription text (Simulated)
    const transcriptionText = document.getElementById('transcriptionOutput').innerText; 

    console.log(`Saving record for ${patientId}. Length: ${transcriptionText.length} characters.`);
    
    // 2. Perform the server update (Using the route we established earlier)
    fetch('/complete-appointment', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
            patientId: patientId, 
            recordContent: transcriptionText // Pass the actual transcription content
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            alert(`Record for ${patientId} saved successfully! Returning to Appointment list.`);
            // 3. Redirect back to the Appointments page after successful save
            window.location.href = '/appointment'; 
        } else {
            alert('Error saving record. Please try again.');
        }
    })
    .catch(error => {
        console.error('Network error during save:', error);
        alert('Could not save record due to a network error.');
    });
}