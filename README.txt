ASSIGNMENT DESK – NODE.JS + MONGODB VERSION
===========================================

WHAT THIS IS
------------
A small server (Node.js) that stores everything in MongoDB and serves both pages:
  Customer site : https://your-site/
  Admin panel   : https://your-site/admin-console-assignment-desk
Rename public/admin-console-assignment-desk.html to something only you know
(example: admin-console-yourname.html), then the URL becomes /admin-console-yourname.

FOLDER
------
server.js            the server and API (security rules live here)
package.json         dependencies (express, mongodb)
.env.example         the settings you must provide
public/index.html    customer website
public/admin-console-assignment-desk.html   your admin panel
public/desk.js       shared browser code

STEP 1 – FREE MONGODB (Atlas)
-----------------------------
1. Go to mongodb.com/atlas, sign up, create a FREE (M0) cluster.
2. Database Access > Add Database User: choose a username and password (save them).
3. Network Access > Add IP Address > "Allow access from anywhere" (0.0.0.0/0),
   because free hosts change IPs.
4. Connect > Drivers > copy the connection string. Replace <password> with your password and
   add a database name before the "?":  ...mongodb.net/assignmentdesk?retryWrites=...
   This whole string is your MONGODB_URI.

STEP 2 – RUN ON YOUR COMPUTER (optional test)
---------------------------------------------
Install Node.js 20+. In this folder:
  copy .env.example to .env and fill it in
  npm install
  node --env-file=.env server.js
Open http://localhost:3000

STEP 2B – BREVO (EMAIL LOGIN CODES FOR CUSTOMERS)
-------------------------------------------------
Customers now log in with a 6-digit code sent to their email, so they can reopen their
requests and chats any time (any browser or phone). Codes are sent through Brevo.
1. Sign up free at brevo.com (300 emails/day on the free plan).
2. Brevo > Senders, Domains & Dedicated IPs > Senders > Add a sender. Use an email you own
   and click the verification link Brevo emails you. This is BREVO_SENDER_EMAIL.
   (For best inbox delivery also authenticate your domain: add the DKIM and DMARC records Brevo shows.)
3. Brevo > top-right menu > SMTP & API > API Keys > Generate a new API key. Copy it (shown once).
   This is BREVO_API_KEY. It is the API key (starts with xkeysib-), not the SMTP key.
4. If Brevo asks, Security > Authorised IPs: deactivate IP blocking (hosts like Render change IPs).
5. Put these in .env (local) or the host's Environment Variables:
     BREVO_API_KEY, BREVO_SENDER_EMAIL, BREVO_SENDER_NAME (optional)

STEP 3 – PUT IT ONLINE (free, Render.com)
-----------------------------------------
1. Upload this folder to a GitHub repository (do NOT upload your .env file).
2. On render.com: New > Web Service > connect the repository.
   Build command: npm install      Start command: node server.js
3. Add these Environment Variables:
     MONGODB_URI     the string from Step 1
     ADMIN_EMAIL     your admin email
     ADMIN_PASSWORD  a long strong password
     SESSION_SECRET  any long random text
     WHATSAPP        918595938353   (country code, no +)
     BREVO_API_KEY, BREVO_SENDER_EMAIL, BREVO_SENDER_NAME   (see Step 2B)
4. Deploy. Open your Render address, then the admin URL, and log in with
   ADMIN_EMAIL and ADMIN_PASSWORD.
Note: Render's free plan sleeps after inactivity, so the first visit can take about
a minute. A paid plan or another host (Railway, Fly.io, a VPS) removes this.

HOW IT WORKS
------------
Customers send a request with their name, MOBILE NUMBER (required), subject, pages and
deadline. They can add photos of the instructions and/or UPLOAD A PDF they want written
(max 8 MB, up to 3 PDFs per request; they can also attach one later from the chat).
You see the mobile number in the admin panel with Call and WhatsApp buttons, and you
download the customer's PDF from the request.

You chat with the customer and send a final price. In the "Final price" box:
  - Price per page and an optional extra/discount.
  - "Include rush charge" tick box + rush %. It is ticked automatically with a suggested %
    when the customer's deadline is close (the % comes from "Prices"). Untick it to waive
    the rush charge: the customer then sees "Rush charge: Waived" in your offer.
  - The server calculates the total (pages x price + rush + extra).
When the customer accepts, a "Continue on WhatsApp" button appears (never before that).

LIVE PROGRESS: in "Work progress" set how many pages are done (+/- buttons or "All done"),
add an optional note, and press "Update progress". The customer sees a progress bar and
"X of Y pages done" in their chat within a few seconds. The request status switches to
"In progress" automatically.

FILES: only the customer can add files (photos and PDFs). The admin panel has no attach
button, and the server also refuses any file upload from the admin.

Use "Prices" in the admin panel to change the starting prices and rush percentages.
The search box in the admin list finds requests by name, mobile number or subject.

OLDER REQUESTS: requests made before the mobile number became required are asked for
their number the next time the customer opens the chat. They cannot message until then.

SECURITY NOTES
--------------
- Admin login is checked on the server. All admin actions need your login token.
- Customers can only open their own chat through a long private ID stored in their browser.
- Customer messages cannot pretend to be you. The server decides who wrote each message.
- Requests are rate limited per IP. Photos are shrunk in the browser and must be JPEG.
- Photos and PDFs are stored inside MongoDB. Delete old requests in the admin panel (this also
  removes their PDFs) to save space. The free Atlas plan has 512 MB, so a few 8 MB PDFs add up.
- PDFs are checked on the server (must really be a PDF, max 8 MB) and are always downloaded as
  files, never opened inside the site. Like chats, they are reachable only with the long private
  request ID.
- Mobile numbers are visible only to you (admin) and to the customer who entered them.
- Change ADMIN_PASSWORD and SESSION_SECRET in your host settings to log everyone out.