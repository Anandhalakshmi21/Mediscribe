let currentPatientId = null; // Global variable to hold the patient ID for modal actions

/**
 * @param {string} patientId - The ID of the patient starting the consultation.
 */
function handleStartConsultation(patientId) {
    fetch('/complete-appointment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId: patientId })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // 2. CRITICAL: REDIRECT WITH QUERY PARAMETER
            window.location.href = `/transcribe?patientId=${patientId}`; 
        } else {
            alert('Error marking appointment as complete.');
        }
    })
    .catch(error => {
        console.error('Network error during consultation start:', error);
        alert('Could not connect to server to start consultation.');
    });
}

/**
 * Handles the click of the history button, showing the summary modal.
 * @param {string} patientId - The ID of the patient whose history is requested.
 */
function viewPatientHistory(patientId) {
    // 1. Fetch data for this patient from the DB (simulated here)
    const patientName = getPatientName(patientId); 

    // 2. Set the global variable and update modal content
    currentPatientId = patientId;
    document.getElementById('modalPatientName').textContent = patientName;
    
    // 3. Display the modal
    document.getElementById('historyModal').style.display = 'block';
    console.log(`Showing history summary for Patient: ${patientId}`);
}

/**
 * Handles the selection of the next appointment date.
 * @param {string} patientId - The ID of the patient.
 * @param {string} dateValue - The selected date in YYYY-MM-DD format.
 */

let selectedPatientId = null;

/**
 * Opens the scheduling modal and sets the context
 */
function openScheduleModal(patientId, patientName) {
    selectedPatientId = patientId;
    document.getElementById('schedulePatientName').textContent = patientName;
    document.getElementById('scheduleModal').style.display = 'block';
}

/**
 * Validates and sends the appointment to the backend
 */
function confirmSchedule() {
    const dateTimeValue = document.getElementById('nextDateTimeInput').value;

    if (!dateTimeValue || !selectedPatientId) {
        alert("Please select a date and time.");
        return;
    }

    fetch('/api/schedule-next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            patientId: selectedPatientId, 
            nextDateTime: dateTimeValue 
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            alert("Appointment successfully saved!");
            closeModal('scheduleModal');
            document.getElementById('nextDateTimeInput').value = ''; // Reset
        } else {
            alert("Error: " + data.message);
        }
    })
    .catch(err => alert("Server error. Please try again."));
}
/**
 * Function to simulate fetching a patient's name based on ID (replace with DB call).
 * @param {string} patientId
 * @returns {string} Patient Name
 */
function getPatientName(patientId) {
    const names = {
        
        // ... more patients
    };
    return names[patientId] || 'Unknown Patient';
}

/**
 * Handles the calendar icon button at the top of the page.
 */
function openDateSelector() {
    document.getElementById('dateSelectorModal').style.display = 'block';
}

/**
 * Simulates fetching and displaying appointments for a selected date.
 * @param {string} date - The date selected by the user.
 */
function fetchAppointments(date) {
    const dateObj = new Date(date);
    const options = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };
    const dateString = dateObj.toLocaleDateString('en-US', options);

    document.getElementById('currentDateHeader').textContent = `Appointments for: ${dateString}`;
    console.log(`Fetching appointments for: ${date}`);
    
}

/**
 * Generic function to close any modal.
 * @param {string} modalId - The ID of the modal element to close.
 */
function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

// Ensure the generic modal closing logic from main.js is also available
window.onclick = function(event) {
    const historyModal = document.getElementById('historyModal');
    const dateModal = document.getElementById('dateSelectorModal');
    if (event.target == historyModal) {
        historyModal.style.display = 'none';
    }
    if (event.target == dateModal) {
        dateModal.style.display = 'none';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const submitBtn = document.getElementById('submitDateFilter'); 
    const modalDateInput = document.getElementById('modalDateInput'); 
    if (submitBtn && modalDateInput) {
        submitBtn.addEventListener('click', function() {
            const selectedDate = modalDateInput.value;
            
            if (selectedDate) {
                const year = selectedDate.split('-')[0];
                if (year.length === 4 && year !== '0002') {
                    window.location.href = `/appointment?date=${selectedDate}`;
                } else {
                    alert("Please enter a valid 4-digit year (e.g., 2025).");
                }
            } else {
                alert("Please select a date.");
            }
        });
    }

    if (modalDateInput) {
        modalDateInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                submitBtn.click(); 
            }
        });
    }
});

