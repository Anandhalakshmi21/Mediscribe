/**
 * Toggles the visibility of a patient's summarized consultation details.
 * @param {string} elementId - The unique ID of the details div (e.g., 'PID1001-20251208').
 */
function toggleDetails(elementId) {
    const detailsDiv = document.getElementById(elementId);
    const summaryDiv = detailsDiv.previousElementSibling;
    
    // Check if the details are currently visible
    const isOpen = detailsDiv.classList.contains('open');

    // Close all other open details (optional, but improves user experience)
    document.querySelectorAll('.item-details.open').forEach(item => {
        if (item.id !== elementId) {
            item.classList.remove('open');
            item.previousElementSibling.classList.remove('active');
        }
    });

    // Toggle the current one
    if (isOpen) {
        detailsDiv.classList.remove('open');
        summaryDiv.classList.remove('active');
    } else {
        detailsDiv.classList.add('open');
        summaryDiv.classList.add('active');
    }
}

/**
 * Simulates viewing the full record (e.g., redirect to a detailed view page).
 * @param {string} patientId - The ID of the patient.
 * @param {string} date - The date of the consultation.
 */
function viewFullRecord(patientId, date) {
    console.log(`Redirecting to full record for Patient: ${patientId}, Date: ${date}`);
    // In a real app, this would redirect to a page showing the full transcription, images, and notes.
    alert(`Viewing full record for ${patientId} on ${date}.`);
    // Example: window.location.href = `/record-detail?pid=${patientId}&date=${date}`;
}

/**
 * Filters the history list based on search bar input (Name or ID).
 */
function filterHistory() {
    const input = document.getElementById('patientSearch');
    const filter = input.value.toUpperCase();
    const historyItems = document.querySelectorAll('.history-item');

    historyItems.forEach(item => {
        const nameElement = item.querySelector('.item-summary .name');
        const idElement = item.querySelector('.item-summary .id');
        
        if (nameElement && idElement) {
            const nameText = nameElement.textContent || nameElement.innerText;
            const idText = idElement.textContent || idElement.innerText;

            if (nameText.toUpperCase().indexOf(filter) > -1 || idText.toUpperCase().indexOf(filter) > -1) {
                // Show the item and its parent date group
                item.style.display = "";
                item.closest('.date-group').style.display = "";
            } else {
                // Hide the item
                item.style.display = "none";
            }
        }
    });

    // Logic to hide date groups if all children are hidden (more complex, but key for neatness)
    document.querySelectorAll('.date-group').forEach(group => {
        const visibleItems = group.querySelectorAll('.history-item:not([style*="display: none"])');
        if (visibleItems.length === 0) {
            group.style.display = "none";
        } else {
            group.style.display = "";
        }
    });
}