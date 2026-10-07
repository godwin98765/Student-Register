# SSM IET Admission Registration – Frontend

Plain HTML, CSS and vanilla JS. No build step.

## Run locally
- Open `index.html` in a browser, or run `python3 -m http.server 8080` in this folder and visit http://localhost:8080.

## Demo credentials (mock mode only)
- Admin (`admin-login.html`): `admin@ssmiet.demo` / `Admin@123`
- Student tracking: ID `SSMIET-2026-000001`, mobile `9876543211`

## Mock mode
`MOCK_MODE: true` keeps all data in browser `localStorage` (key `ssmiet_apps`), seeded from `assets/js/mock-data.js`. Uploaded files are validated but not stored (file names only). Clear site data to reset.

## Connecting AWS
Edit the `CONFIG` block at the top of `assets/js/app.js`: set `MOCK_MODE:false` and `API_BASE_URL` to your API Gateway URL. Endpoints used: `GET /courses`, `POST /applications`, `GET /applications/status`, `POST /documents/upload-url`, `GET /admin/applications`, `GET /admin/applications/{id}`, `PATCH /admin/applications/{id}/status`, `GET /admin/reports/export`.
Admin sign-in in real mode must use Cognito: store the ID token in `localStorage` key `ssmiet_token` (sent as the `Authorization` header). The login page currently shows a placeholder message in real mode.

## Logo
Drop your logo at `assets/images/ssmiet-logo.png`; a text logo "SSM IET" shows if it is missing.

## Known limits of this first build
Cognito login flow, full-page animated SVG scenery and extra graphics (documents, campus, pathway) are not included yet.

## Security notes
- Every dynamic value is HTML-escaped before display; CSV export neutralises formulas; uploads are checked by type, extension and size (2 MB) in the browser **and must be re-checked server-side**.
- The mock admin login is client-side only and exists purely for demos. In production, admin access is enforced by Cognito + the API Gateway authorizer, never by the frontend. Before deploying, remove `DEMO` and `SEED` from `assets/js/mock-data.js`.
- In real mode the Cognito token is kept in `sessionStorage` (cleared when the tab closes) and sent as `Authorization: Bearer <token>`.
- Security headers (CSP, HSTS, etc.) are set on CloudFront, not in the HTML — see `aws-deployment-guide.md`, "Security hardening".
