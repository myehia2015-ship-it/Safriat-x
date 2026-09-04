Safariat X — Project Guidelines
Project Structure
Single HTML file only: index.html
Do NOT create separate CSS or JS files
All styles and scripts must stay inside the HTML file
Design Rules
Language: Arabic, RTL layout always
Primary color: #d97757 (terracotta)
Dark theme background (#0f0f0f)
All UI text must be in Arabic
Firebase
Realtime Database: safariat-x-default-rtdb
Firebase Authentication is used (email/password for admin, anonymous auth for clients)
Do NOT change the Firebase config or database structure
Bookings stored under /bookings/ node, each booking includes clientUid
Drivers stored under /drivers/ node, each driver includes driverUid
Roles stored under /roles/{uid} — read-only from client code, only settable manually via Firebase Console
Security Rules enforce: admin role can read/write everything; clients can only create their own bookings and read their own; drivers similarly scoped
Admin Panel
NOT accessible via URL parameter (old ?admin=safariat2026 method was removed for security)
Access is via a hidden gesture: tap the "سفريات اكس 🚗" topbar logo 5 times within 2 seconds
Requires real Firebase Auth login (email/password) AND a matching admin role in /roles/{uid}
Do NOT reintroduce URL-based admin access — it is insecure (leaks via browser history/referrers)
WhatsApp Notifications
New bookings trigger a fire-and-forget webhook call to a Pipedream endpoint
Pipedream forwards the message to a WhatsApp group via Green API
No secrets/API keys are stored in index.html — only the public Pipedream webhook URL is client-side
Never hardcode Firebase Admin SDK keys or Green API tokens into index.html
Security Notes
Never expose Firebase Admin SDK service account keys anywhere in chat, code, or client-side files
Anonymous Firebase Auth is used for all first-time visitors (auto sign-in)
isAdminAuthed() must always check: authenticated + not anonymous + role === 'admin'
Before Coding
Think before writing any code
Only edit what is necessary
Keep everything as simple as possible
Confirm the goal before starting
Deployment
GitHub Pages deployment: myehia2015-ship-it.github.io/Safriat-x/
Always test RTL layout after any UI change
After any meaningful change (colors, architecture, new rules), update this CLAUDE.md file to match
