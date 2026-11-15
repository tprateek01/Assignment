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
4. Deploy. Open your Render address, then the admin URL, and log in with
   ADMIN_EMAIL and ADMIN_PASSWORD.
Note: Render's free plan sleeps after inactivity, so the first visit can take about
a minute. A paid plan or another host (Railway, Fly.io, a VPS) removes this.

HOW IT WORKS
------------
Customers send a request with photos and chat with you on the site. You send a
final price per page. When the customer accepts it, a "Continue on WhatsApp" button
appears (it never shows before that). Use "Prices" in the admin panel to change the
starting prices and rush charges customers see.

SECURITY NOTES
--------------
- Admin login is checked on the server. All admin actions need your login token.
- Customers can only open their own chat through a long private ID stored in their browser.
- Customer messages cannot pretend to be you. The server decides who wrote each message.
- Requests are rate limited per IP. Photos are shrunk in the browser and must be JPEG.
- Photos are stored inside MongoDB. Delete old requests in the admin panel to save space
  (the free Atlas plan has 512 MB).
- Change ADMIN_PASSWORD and SESSION_SECRET in your host settings to log everyone out.
