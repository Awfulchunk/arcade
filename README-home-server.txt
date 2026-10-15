TOUGH & J'S HOME-PC SERVER  (tj-home-server.mjs), locked down
==============================================================
What it is: one small file you run on your PC. Your phone talks to it over your home Wi-Fi.
It does two things:
  1. Takes big file uploads (the Cartridge "Upload to Tough" protocol: 4 MB chunks, resumes if the Wi-Fi drops).
  2. Powers the Needle music card: pull a link as mp3/m4a/wav/ogg/mp4, convert audio, read odd formats.

HOW IT IS LOCKED DOWN
  - Every single request needs a long secret token (64 random characters). No token or a wrong one = "401 unauthorized".
  - Wrong tries are counted. 8 wrong tries from one address = locked out for 15 minutes.
  - It only listens on your home network address (and this PC itself). Anything not from a home-network address is dropped.
  - Only the arcade may talk to it from a browser (https://awfulchunk.github.io and the app's own page). Other websites get "403".
  - It never lists folders and never serves files by path. Uploaded names are cleaned so nothing can escape the upload folder.
  - Pulling a link will not touch other machines on your home network (private addresses are refused).
  - The token lives in a file in YOUR home folder (~/.tj-home-server/token.txt, or C:\Users\you\.tj-home-server\token.txt),
    readable only by you. It is not in the script folder, not in the arcade, not on the website.

What you need on the PC (one time)
  - Node.js 18 or newer: https://nodejs.org  (download the LTS, click through the installer).
  - Optional, for Needle: ffmpeg (https://ffmpeg.org/download.html) and yt-dlp (https://github.com/yt-dlp/yt-dlp)
    Both must be "on the PATH": open a terminal and type  ffmpeg -version  and  yt-dlp --version  to check.
    No ffmpeg: uploads still work, Needle convert is off. No yt-dlp: Needle only pulls direct file links (ending .mp3 etc.), not YouTube.

Steps
  1. Put tj-home-server.mjs in a folder, for example C:\tj  (or ~/tj on Mac/Linux).
  2. Open a terminal in that folder and run:   node tj-home-server.mjs
  3. FIRST RUN ONLY it prints your token once:
        Address for the phone:  http://192.168.1.20:8765
        Token (secret, paste it into the app):
          9f2c...64 characters...e1
     Copy the token somewhere private (a password manager is perfect). Do not post it anywhere or send it in a chat.
     Later runs do not print it. To see it again run:   node tj-home-server.mjs --show-token
  4. Leave the window open. Close it (Ctrl+C) to stop the server.
  5. Phone on the SAME Wi-Fi as the PC.
  6. If a firewall box pops up on the PC, allow Node on PRIVATE networks only (not Public).
     If the phone cannot reach it, allow port 8765 for Private networks.
  7. Quick check from the PC itself (needs the token, so a plain browser visit shows "unauthorized", which is correct):
        curl -H "Authorization: Bearer YOUR_TOKEN" http://192.168.1.20:8765/health
     You should see {"ok":true,...}.

Using your own token instead
  node tj-home-server.mjs --token "a-long-secret-at-least-24-characters"
  (Shorter than 24 characters is refused. It is not saved to disk when you pass it this way.)
  To make a NEW random token (for example if you think it leaked): stop the server, delete the token file
  (~/.tj-home-server/token.txt), start it again, and update the token in the phone.

Needle (music card)  (needs arcade app 2.7.2 or newer)
  - Open the Needle card > settings (gear). Fill in:
      Home-PC server address:  http://192.168.1.20:8765  (the address the server printed)
      Home-PC server token:    the long token from the server window or token file
    Tap "Test connection". It tells you in plain words if it works, if the token is wrong, or if it cannot reach the PC.
  - The token is kept only on that phone. Needle sends it as "Authorization: Bearer <token>" on every pull, convert and cut call.

Cartridge upload  (needs arcade app 2.7.2 or newer)
  - Open Cartridge > Backup > Big Files > "Home server address + token". Fill in the same address and token, tap Test, then Save.
  - Once saved, the green light shows whether your PC answers, and "Upload to Tough" sends the file straight to your PC with the
    token (Authorization: Bearer). Files are saved in the tj-uploads folder next to the script.
  - Clear the box and Cartridge goes back to the published Tough link (which never has a token).
  - The address/token are saved in the app on that phone only. NEVER put the real token into tough-link.json or anything on the
    website: that file is public. This server only works while the phone is on the same Wi-Fi as the PC.

Options
  --port 9000                      (or PORT=9000)
  --token "long secret"            (or TJ_TOKEN=...)
  --dir D:\uploads                 where uploads go (or DIR=...)
  --host 192.168.1.20              listen only on this one address
  --origin https://my.site         allow one more website to call it (can repeat)
  --show-token                     print the saved token again
  --config-dir <folder>            where the token file lives
  Windows (cmd):   node tj-home-server.mjs --port 9000
  Mac/Linux:       node tj-home-server.mjs --port 9000

Good habits
  - Only run it while you need it, on a Wi-Fi you trust. Do not forward port 8765 on your router, ever.
  - If the token ever leaks, make a new one (see above).
  - Nothing is sent to the internet except what yt-dlp / a direct link you ask for fetches.
