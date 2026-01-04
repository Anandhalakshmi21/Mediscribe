/**
 * Loads the user's preferred theme from local storage on page load.
 */
document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('appTheme') || 'light';
    changeTheme(savedTheme, false); // Apply theme without saving again
    document.getElementById('themeSelect').value = savedTheme;
});

/**
 * Changes the application's theme (Light/Dark Mode).
 * @param {string} theme - The selected theme ('light' or 'dark').
 * @param {boolean} save - Whether to save the preference to local storage. Default is true.
 */
function changeTheme(theme, save = true) {
    const body = document.body;
    if (theme === 'dark') {
        body.classList.add('dark-mode');
    } else {
        body.classList.remove('dark-mode');
    }

    if (save) {
        localStorage.setItem('appTheme', theme);
        console.log(`Theme set to: ${theme}`);
    }
}

/**
 * Previews the selected image file before uploading.
 * @param {Event} event - The file input change event.
 */
function previewPhoto(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            document.getElementById('profilePhoto').src = e.target.result;
        }
        reader.readAsDataURL(file);
        // Note: Actual upload to the server would happen here or via a dedicated save button
        console.log('New profile photo selected. Ready to upload.');
    }
}

/**
 * Saves the contents of a profile textarea to the database (simulated).
 * @param {string} fieldId - The ID of the field being saved ('qualifications' or 'experience').
 */
function saveProfile(fieldId) {
    const content = document.getElementById(fieldId).value;
    // In a real app, this triggers an AJAX call to the backend
    console.log(`Saving ${fieldId}: "${content.substring(0, 30)}..."`);
    // Optional feedback
    // alert(`${fieldId} updated.`);
}

/**
 * Simulates logging the user out of the application.
 */
function logoutUser() {
    if (confirm('Are you sure you want to log out?')) {
        // Clear any local session tokens/data
        localStorage.removeItem('userToken'); 
        console.log('User logged out.');
        // Redirect to the login page
        window.location.href = '/login'; 
    }
}