async function updateNav() {
    try {
        const res = await fetch('/profile-data');
        const isLoggedIn = res.ok;
        
        document.querySelectorAll('.user-only').forEach(el => {
            el.style.display = isLoggedIn ? '' : 'none';
        });
        document.querySelectorAll('.guest-only').forEach(el => {
            el.style.display = isLoggedIn ? 'none' : '';
        });
    } catch (err) {
        console.error("Nav update failed", err);
    }
}

async function logout() {
    try {
        const res = await fetch('/logout', { method: 'POST' });
        if (res.ok) {
            window.location.href = '/login.html';
        }
    } catch (err) {
        console.error("Logout failed", err);
    }
}

// Run on load
document.addEventListener('DOMContentLoaded', updateNav);
