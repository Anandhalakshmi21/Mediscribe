// Function for Doctor Home: Clicking next appointment box
function goToAppointmentPage(patientId) {
    console.log(`Navigating to appointment details for Patient ID: ${patientId}`);
    // In a real app, this would route to the Appointment page and potentially open the transcription modal immediately
   window.location.href = `/transcribe?patientId=${patientId}`;
}

// Function for Assistant Home: Modal handling
function openAppointmentModal() {
    document.getElementById('appointmentModal').style.display = 'block';
}

function closeAppointmentModal() {
    document.getElementById('appointmentModal').style.display = 'none';
}

// Close the modal if the user clicks anywhere outside of it
window.onclick = function(event) {
    const modal = document.getElementById('appointmentModal');
    if (event.target == modal) {
        modal.style.display = 'none';
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    
    
});

// --------------------------
// Upload Options Dropdown
// --------------------------
function toggleUploadDropdown() {
    const dropdown = document.getElementById("uploadDropdownContent");
    dropdown.classList.toggle("show");
}

// Close dropdown if clicking outside
window.addEventListener("click", function(event) {
    // If the click is NOT on the upload button or the dropdown itself
    if (!event.target.matches('.upload-btn') && !event.target.closest('.dropdown-content')) {
        const dropdown = document.getElementById("uploadDropdownContent");
        if (dropdown.classList.contains("show")) {
            dropdown.classList.remove("show");
        }
    }
});
