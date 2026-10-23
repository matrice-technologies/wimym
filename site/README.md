# The public page

wimym.matricetechnologies.com: what Wimym does and how to set it up. Static: `index.html`, the app's fonts
and tokens, and `media/`, every image and video captured from the demo person (Robin Vale,
`./install.sh --demo`), never from real data. The social image `og.jpg` is Robin's postcard.

Hosted on Vercel, project `wimym` (shanoirs-projects). To publish a change, from this folder:

```bash
vercel deploy --prod
```

Setup step 1 points at the private repo matrice-technologies/wimym (by invitation). `bin/ship-code` updates that repo from main.
