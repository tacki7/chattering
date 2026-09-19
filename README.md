# Tandem Chatter Lab

Web app for exploring chatter (vibration) of a 1–6 stand tandem cold mill (4Hi / 6Hi / 20Hi).

- `src/` — sources (`model.js` physics, `app.js` UI, `style.css`, `page.html`, `doc.html`)
- `dist/chatter-lab.html` — single-file build, open directly in a browser
- Build: `cd src && node build.js`
- Tests: `cd src && node test_model.js && node test_sim.js` (needs `ml-matrix` UMD saved as `src/mlmatrix.umd.js`, from `https://cdn.jsdelivr.net/npm/ml-matrix@6.11.1/matrix.umd.js`)
