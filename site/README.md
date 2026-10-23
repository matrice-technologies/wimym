# The public page

wimym.matricetechnologies.com: what Wimym does and how to set it up. Static: `index.html`, the app's fonts
and tokens, and `media/`, every image and video captured from the demo person (Robin Vale,
`./install.sh --demo`), never from real data. The social image `og.jpg` is Robin's postcard.

Hosted on Vercel, project `wimym` (shanoirs-projects). To publish a change, from this folder:

```bash
vercel deploy --prod
```

The setup starts with one prompt people paste into Claude Code; it has Claude read `setup.md`, the guide
written for Claude, and follow it step by step. Change the steps there and in the page's "by hand"
list together. Both point at the private repo matrice-technologies/wimym (by invitation).
`bin/ship-code` updates that repo from main.
