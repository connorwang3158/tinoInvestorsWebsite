# Editing the site

Officers can change the **Officers**, **Competitions** and **Resources** pages right on the website.
Sign in with the club Google account (tinoinvestors@gmail.com), click the text you want to change,
and save. Photos and logos can be swapped too. No other account can save anything.

Changes are stored in Firebase (Google's free app backend). It needs a one-time setup, below.

## Using the editor

1. Open the Officers, Competitions or Resources page.
2. Click **Officer Login** in the gray bar at the top right and sign in with tinoinvestors@gmail.com.
3. Anything with a dotted green outline can be edited. Click it and type.
   - **Officers:** name, role and bio. **Change photo** uploads a headshot (any size works; it's shrunk automatically).
   - **Competitions:** name, description, each date line, and the website link. **Change logo** swaps the logo,
     and **+ Add a date line** adds a line like "Register by: Feb 19".
   - **Resources:** **+ Add meeting slides**, then pick the date, type a title and paste the slides link.
     The list always shows the newest meeting first.
   - **↑ Move up**, **↓ Move down** and **Remove** rearrange or delete things.
4. Click **Save changes** in the black bar. Everyone sees the new version right away.

The first time you save a page, its current list is copied into the editor. After that, the editor's version
is what the site shows, and the list written in the HTML file (or `slides.txt`) is only a backup.

## One-time setup (about 10 minutes)

Do all of this while signed in to Google as **tinoinvestors@gmail.com**.

1. **Create the project.** Go to <https://console.firebase.google.com>, click **Create a project**, name it
   `tino-investors`, turn off Google Analytics, and create it.
2. **Turn on Google sign-in.** In the left menu open **Build → Authentication → Get started → Sign-in method**,
   choose **Google**, switch it on, pick tinoinvestors@gmail.com as the support email, and save.
3. **Allow the website's address.** Still in Authentication, open **Settings → Authorized domains** and add the
   site's address, for example `tinoinvestors.vercel.app` (plus a custom domain if you have one).
   `localhost` is already listed, so testing on your computer works.
4. **Create the database.** Open **Build → Firestore Database → Create database**. Pick a location near
   California (for example `us-west1`), choose **production mode**, and create it.
5. **Lock it to the club account.** In Firestore, open the **Rules** tab, replace everything with the rules
   below, and click **Publish**.
6. **Connect the website.** Click the gear icon → **Project settings → General → Your apps**, click the web
   icon `</>`, name the app `website`, and register it (skip Firebase Hosting). Copy the `firebaseConfig`
   values it shows into `js/firebase-config.js`, replacing `null` (the file has an example).
7. Commit and push. After Vercel redeploys, **Officer Login** appears on the three pages.

### Firestore rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /site/{page} {
      // Anyone can read the saved pages, so every visitor sees them
      allow read: if true;
      // Only the club account can save, and only these three pages
      allow write: if request.auth != null
        && request.auth.token.email == 'tinoinvestors@gmail.com'
        && request.auth.token.email_verified == true
        && page in ['officers', 'competitions', 'resources'];
    }
  }
}
```

## Good to know

- **Cost:** the free Spark plan is plenty. Photos are shrunk and saved with the page, so Firebase Storage
  (which needs a paid plan) isn't used.
- **Safety:** the values in `js/firebase-config.js` are meant to be public. The rules above are what stop
  anyone else from saving.
- **Changing the editor account:** update `EDITOR_EMAIL` in `js/firebase-config.js` and the email in the rules.
