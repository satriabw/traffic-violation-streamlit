# Traffic Violation Console

A Streamlit operator front end for `site-service` — the demo UI for the
[traffic-violation](../traffic-violation) backend. It covers every endpoint in
`Traffic Violation API.postman_collection.json`, plus the ones the collection lists
without filling in (`GET .../violations` and the three `.../review` routes).

## Run it

The backend first — from the `traffic-violation` repo:

```bash
docker compose up          # publishes the API on 127.0.0.1:8001
```

Then this:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env       # only if you need a non-default API_BASE_URL
.venv/bin/streamlit run serve.py
```

It opens on <http://localhost:8501>. `serve.py` is `app.py` plus a `/storage/…` route
that relays the backend's stored files (videos, clips, downloads) with byte ranges, so
the browser only ever needs port 8501 — over an SSH tunnel, forward that one port.
`streamlit run app.py` also works, but then the browser must reach the API itself.

The API address is under **Connection** in the sidebar, next to a status dot that turns
red when `/health` stops answering. Restart the server after changing anything under
`lib/`: Streamlit reruns a page on change, but keeps imported modules it already loaded.

## The pages

| Page | What it does | Endpoints |
|---|---|---|
| **Overview** | Key figures, violations per day and per site, sites table, recent runs | `GET /sites`, `GET .../violations`, `GET .../runs` |
| **Site view** | The current video or live feed with the configuration's regions overlaid, per layer | `GET .../sources`, `GET .../configurations`, `GET /files/{id}` |
| **Sites** | Create, filter, select, delete | `GET/POST /sites`, `GET/DELETE /sites/{id}` |
| **Site Setup** | Upload + attach calibration, configuration, source; invalidate a wrong document's runs; readiness checklist | `POST /files`, presigned `PUT`, `POST /files/{id}/complete`, `GET/POST .../calibrations`, `.../configurations`, `POST .../{id}/invalidate`, `.../sources` |
| **Detection** | Start a session on a video or live feed, stop a feed, watch its runs | `POST /sites/{id}/detect`, `POST .../sources/{id}/stop`, `GET .../runs` |
| **Violations** | Review queue (filterable by run), evidence overlay, trajectories, the evidence review followed live | `GET .../violations?run_id=`, `GET .../violations/{id}`, `POST/GET .../review`, `GET .../review/events` |
| **Files** | Upload without attaching; look up by id | `POST /files`, `PUT`, `POST .../complete`, `GET /files/{id}` |

## Things that are the way they are for a reason

**The upload sends the headers the URL says it was signed with.** `presigned_put` puts
whatever it is given into the signature — always `Content-Length`, and `Content-Type`
too whenever the file row carries one — and the client must send back the identical
header or R2 answers `403 SignatureDoesNotMatch`. `api.put_object` reads the list out
of the URL's `X-Amz-SignedHeaders` rather than hardcoding it, so it follows the server
if that ever changes.

**Trajectories are not drawn over the image.** `bboxes` are pixels; `trajectory` is
metres on the ground plane. Two objects the same distance apart on screen are metres
apart at the bottom of a frame and tens of metres apart at the top, so a ground-plane
path drawn over a perspective image lands somewhere plausible and wrong. Boxes go on
the thumbnail, paths go in their own top-down plot.

**Boxes are drawn at read time, not baked in.** `evidence-worker` stores a clean frame
on purpose, so the drawing lives here and improving it improves every violation ever
recorded.

**Three tracks are colourable at a time.** The ground plot is a spatial form where any
two series can end up adjacent, and only the first three slots of the palette clear the
colour-vision-deficiency floors under all-pairs comparison. A fourth hue would be a
worse chart, not a fuller one. Everything unselected is still outlined, in grey.

**The review is followed, not polled.** `POST .../review` answers 202 and hands the
work to an actor; 200 means one is already running or finished, so the button is safe
to press repeatedly and only the first press spends money. The page then reads
`GET .../review/events` — server-sent events the backend writes as the review goes —
and redraws its steps in place until the stream ends. The finished review comes from
`GET .../review`. A finished review's events are played back at up to 1.5 s apart, so
the steps (facts, questions to the legal source, answers) are read only when "Show the
steps it took" is switched on, and cached after.

**The review lives in the violation's explanation columns.** `explanation_status` is
still the field on a violation: `detected` is not reviewed, `pending` is running,
`explained` is completed. The page shows them in the review's words.

**`evidence_status: null` is not `pending`.** Null means the violation predates
`evidence-worker` and nothing will ever build its clip. It renders grey and says
"none", because an amber chip on a row that will never change is a lie.

**The violation list has no filter parameters, deliberately.** It resolves to the site's
*active* calibration and configuration, matched by document **id**. Attach a new
configuration and violations recorded under the old one drop out of the list without
being touched — they are still there on the detail endpoint. Worth knowing before
uploading a configuration mid-demo.

**Speeds are sanity-checked.** Anything over 60 m/s (216 km/h) raises a note saying the
calibration does not hold, rather than presenting the number deadpan. Speeds derive from
the ground-plane projection, so a wrong calibration scales all of them together.

## Layout

```
app.py              overview / landing
lib/api.py          every endpoint, as functions; knows nothing about Streamlit
lib/ui.py           status-chip vocabulary, sidebar, error rendering, formatting
lib/evidence.py     box drawing, ground plot, speed plot, the table view
lib/review.py       the evidence review: drawing it, and following its event stream
pages/              one file per page, numbered for sidebar order
```

`lib/api.py` is importable on its own, which is how it was tested against the live
stack.
# traffic-violation-streamlit
