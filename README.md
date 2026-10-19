# m.boutiquehomes

Luxury property website: public pages (`/`, `/listings`) and an admin back office (`/admin`),
served by a small Node.js + Express app that stores everything in **MySQL**.

```
Browser (/, /listings, /admin)  →  Express API  →  MySQL
```

| Path | What it is |
|---|---|
| `/` | Home: hero banner, listings, team |
| `/listings` | Listings page |
| `/admin` | Admin login page (6-digit passcode). Signed-in admins are sent straight to the dashboard |
| `/admin/dashboard` | The control panel: hero banner, listings, team. The server only sends it to a signed-in admin, everyone else is redirected to `/admin` |
| `/api/content` | Public JSON the pages read |
| `/api/admin/*` | Admin API (needs the login cookie) |

```
public/     static site (HTML, CSS, JS, img/) incl. the public admin login page
private/    admin dashboard (HTML + script) – served only to a signed-in admin, never as plain static files
server/     Express app (server.js, repo.js = all SQL, validate.js, schema.sql, seed-data.js)
scripts/    init-db.js (tables + default content), set-admin.js (admin account)
uploads/    images uploaded from /admin (not in git)
```

## Quick start: built-in local database (recommended for testing)

No MySQL account needed. The project can run its **own real MySQL server** (Homebrew's `mysql` must be
installed). It listens on `127.0.0.1:3307` and keeps its data in `./.mysql/` (git-ignored), so it never
touches a MySQL you already run on port 3306.

```bash
npm install
npm run dev:setup      # first time only: creates the server, database, user, .env and loads the default content
npm run set-admin      # choose the OWNER's 6-digit passcode (add colleagues later in /admin → 管理员)
npm start              # http://localhost:3000   (admin: http://localhost:3000/admin)
```

| Command | What it does |
|---|---|
| `npm run dev:db` | Start the database again (e.g. after a reboot) |
| `npm run dev:db:stop` | Stop it (data is kept) |
| `npm run dev:db:status` | Is it running? |
| `npm run dev:setup` | Safe to re-run: keeps your data and admin account |

Everything you add in `/admin` (listings, team, photos) is stored in this database and survives restarts.
To start from zero, stop the database and delete the `.mysql/` folder, then run `npm run dev:setup` again.

## Listing photos

A listing can have up to 20 photos (dashboard -> 房源管理 -> add / edit). Pick several at once, reorder them with the arrows,
make any photo the cover with the star, remove with the cross. The first photo is the **cover** (shown on the listing card).

On the site the detail sheet shows the photos like a messaging-app album: **one big picture on the left, the 2nd photo top
right, the 3rd bottom right**. With more than three photos the bottom-right tile is blurred and shows "+N" (N = pictures not
shown). Tapping any tile opens a full-screen viewer (swipe, arrows or the keyboard; Esc closes it). The admin form shows the
same layout as a live preview. Removing a photo, or deleting a listing, also deletes the uploaded files nobody uses any more.

## Scheduled hero banners

In the dashboard, **首页横幅** manages which picture the home page shows. Everything is calculated in **GMT+8**
(Malaysia time), whatever the visitor's own time zone:

- **Day** is 07:00-19:00, **night** is 19:00-07:00.
- Each banner has a **time slot** (all day / day / night) and a **date range** (every day, or from-to, both ends included).
- If several banners match, the most specific one wins: date range + day/night > date range > day/night only > every day.
  Nothing matches -> the **default banner**.
- The home page switches picture by itself at 07:00, 19:00 and midnight, without a reload.
- **预览其他时间** shows what visitors will see on any date / time slot; **此刻正在显示** shows what they see right now.
- Disabled banners are kept in the list but never shown. Deleting a banner also deletes its uploaded picture file.

## Use the LIVE database from your own computer (optional, be careful)

The live MySQL only listens on the VPS itself, so your computer reaches it through an SSH tunnel.
Switching is one command each way and never touches your admin account or secrets:

```bash
npm run use:vps      # first time it asks for the SSH login and the live DB password, then asks you to type "yes"
npm run tunnel       # in a SECOND terminal tab: opens the SSH tunnel (type the VPS password, leave it running)
npm start            # the site on http://localhost:3000 now reads and writes the LIVE data
npm run use:local    # switch back to the local test database when you are done
npm run db:mode      # which database is .env pointing at?
```

While connected to the live database:
- Everything you change in `/admin` changes the **real website immediately** and cannot be undone.
- The admin page shows a red warning banner and the server prints a warning when it starts.
- **Image upload is disabled** (the files would only exist on your computer and the live site would show broken images).
  Upload images in the live admin at `https://mboutiquehomes.online/admin/`, or paste an image link instead.
- The live DB password is stored in `.db-vps.json` (git-ignored, owner-only permissions).

## Run it with your own MySQL

Needs Node 18+ and MySQL 8+.

1. Create the database and a dedicated MySQL user (use your own strong password):

   ```sql
   CREATE DATABASE `m.boutiquehomes` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'm.boutiquehomes'@'localhost' IDENTIFIED BY 'a-strong-password';
   GRANT ALL PRIVILEGES ON `m.boutiquehomes`.* TO 'm.boutiquehomes'@'localhost';
   ```

   (If you get "access denied" when connecting through `127.0.0.1`, create the same user for `'127.0.0.1'` too.)

2. Install and configure:

   ```bash
   npm install
   cp .env.example .env      # then put the MySQL password in DB_PASSWORD
   npm run db:init           # creates the tables and loads the default content
   npm run set-admin         # asks for the owner's 6-digit passcode (stored as a hash in the database)
   npm start                 # http://localhost:3000   (admin: http://localhost:3000/admin)
   ```

## Deploy on a VPS (Ubuntu example)

1. **Install** Node.js 20+, MySQL 8, nginx and certbot. Keep MySQL listening on `127.0.0.1` only.
2. **Database**: run the SQL from the section above on the server (different password!).
3. **Code**: copy the project to the server (e.g. `/var/www/luxe`), then:

   ```bash
   npm ci --omit=dev
   cp .env.example .env     # set DB_*, PORT=3000, NODE_ENV=production
   npm run db:init
   npm run set-admin
   ```

4. **Keep it running** with pm2 (or a systemd service):

   ```bash
   npm i -g pm2
   pm2 start server/server.js --name luxe
   pm2 save && pm2 startup
   ```

5. **nginx** reverse proxy, then HTTPS with certbot. HTTPS is required in production because the
   admin login cookie is marked `Secure`:

   ```nginx
   server {
       server_name example.com;
       client_max_body_size 8m;          # admin image uploads

       location / {
           proxy_pass http://127.0.0.1:3000;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```

   ```bash
   sudo certbot --nginx -d example.com
   ```

6. **Firewall**: allow only 22, 80 and 443.
7. **Backups**: back up the MySQL database (`mysqldump m.boutiquehomes`) **and** the `uploads/` folder.

## Security notes

- Admins sign in with a **6-digit passcode** (no username). **Each person has their own passcode**; the one that matches
  tells the server who is signing in. Only bcrypt hashes are stored, in the `admins` table of the database.
- The first admin is the **owner**. Only the owner can add, rename, disable, re-enable, delete other admins or reset their
  passcode (dashboard → 管理员). Everybody can change their own passcode (they must type the current one).
  Disabling or deleting an admin takes effect **immediately**, even if they are signed in right now.
  The owner cannot be disabled or deleted, and nobody can disable themselves; two admins can never share a passcode.
- Obvious passcodes (`123456`, `000000`, `121212`...) are refused.
- A 6-digit code has only 1,000,000 combinations, and every extra admin adds one more valid code, so guessing is limited hard:
  **5 wrong tries per 15 minutes per IP and 15 wrong tries per hour across all visitors**, then the login is locked (limits reset
  when the app restarts). The side effect is that someone hammering the login can lock you out for up to an hour; wait, or restart
  the app (`pm2 restart boutique`) to clear it.
- The session is an `HttpOnly`, `SameSite=Strict` cookie (`Secure` in production) that expires after 12 hours.
- Never commit `.env` (it is in `.gitignore`).
- Uploads are checked by their real file signature (JPEG/PNG/WebP/GIF only, max 6 MB) and renamed to random names.
- All SQL uses parameterised queries; text from the admin is escaped before it is shown on the pages.
- Forgot the owner's passcode? Run `npm run set-admin` on the server: it resets the owner's passcode in the database (no restart needed).
  It always prints which database it is about to change first.
