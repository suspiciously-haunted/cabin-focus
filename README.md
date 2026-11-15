# Cabin Focus

A personal focus timer that works like a flight. Pick a departure and destination on a satellite map, get a boarding pass, and focus while your plane flies the route. Every hour of real flight time becomes 10 minutes of focus.

- Satellite map with clickable airports (about 210), decluttered so they stay evenly spread as you zoom
- Boarding pass with purpose of travel, torn to board, stamped LANDED or DIVERTED, kept in a logbook
- Focus percentage: share of the flight spent on the tab
- Fun fact about the destination country on landing
- Flight Attendant: a reminder every 30 minutes to drink water or rest your eyes
- Hold, divert, full screen, and resume after a refresh

## Run

Open `index.html` in a browser, or serve the folder over HTTP. It needs internet for the map tiles, Leaflet and Google Fonts.

## Files

- `index.html`: page layout
- `styles.css`: styles
- `data.js`: airports and country facts
- `app.js`: map, timer, tickets and logbook
- `fonts/`: OCR-A and Singapore Sling (see `fonts/LICENSES.md`)
