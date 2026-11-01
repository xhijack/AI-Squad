# IndexNow

IndexNow tells Bing and other search engines at once that pages changed. It is the only write the squad's Google
connector makes, and it needs the owner's approval each time (on the Desk; never in automated runs).

## One-time setup
1. Make a key: 8 to 128 letters, digits or dashes, for example 32 random hex characters.
2. Put a text file named `<key>.txt` at the root of the site, containing only the key
   (`https://www.example.com/<key>.txt`). This proves the site is yours. Publishing the file is a change to the live
   site: the owner does it, or approves a pull request that adds it.
3. Enter the key and the site's address in Floor settings → Google. The key is not a secret: it is public on the site.

## Each time
- Only pages the owner approved and published, at most 100 URLs per submit, all on the Space's own site.
- The server checks that the key file is on the site before it submits, and the Squad Log records the submit.
