/**
 *
 * @param {string} role - The selected role ('doctor' or 'assistant').
 */
function toggleDoctorFields(role) {
    const doctorFieldsDiv = document.getElementById('doctorFields');
    const licenseInput = document.getElementById('signupLicense');
    const specialtyInput = document.getElementById('signupSpecialization');
    
    if (role === 'doctor') {
        doctorFieldsDiv.style.display = 'block';
        
        licenseInput.setAttribute('required', 'required'); 
        
        specialtyInput.setAttribute('required', 'required'); 
        
    } else {
        doctorFieldsDiv.style.display = 'none';
        
        licenseInput.removeAttribute('required'); 
        
        specialtyInput.removeAttribute('required'); 
    }
}

document.addEventListener('DOMContentLoaded', () => {
    /*const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const role = document.getElementById('loginRole').value;
            console.log(`Attempting login as: ${role}`);
            
            if (role === 'doctor') {
                window.location.href = '/home/doctor';
            } else if (role === 'assistant') {
                window.location.href = '/home/assistant';
            } else {
                alert('Please select a role.');
            }
        });
    }*/

});