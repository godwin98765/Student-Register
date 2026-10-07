# AWS Deployment Guide (Management Console)

Use one region (e.g. ap-south-1). Never put AWS keys in code.

1. **IAM roles** – IAM > Roles > Create role > AWS service > Lambda. Create one role per function (`ssmiet-lambda-<name>`) with `AWSLambdaBasicExecutionRole` plus an inline policy allowing only the needed actions on the specific table ARNs and `s3:PutObject`/`s3:GetObject` on `arn:aws:s3:::<docs-bucket>/applications/*`.
2. **Private document bucket** – S3 > Create bucket `ssmiet-documents-<account-id>`; keep **Block all public access** ON; default encryption SSE-S3; versioning on. CORS: allow `PUT` from your CloudFront domain only.
3. **DynamoDB** (on-demand): `ssmiet-courses` (PK `courseId`), `ssmiet-applications` (PK `applicationId`; GSI on `status` + `createdAt`), `ssmiet-documents` (PK `applicationId`, SK `docKey`; metadata only), `ssmiet-history` (PK `applicationId`, SK `timestamp`). Add the 15 programmes to `ssmiet-courses`.
4. **Lambda** (Node.js 20): `getCourses`, `createApplication`, `getStatus`, `createUploadUrl`, `adminList`, `adminGet`, `adminUpdateStatus`, `adminExport`. Set env vars for table names and bucket. `createUploadUrl` validates type (PDF/JPG/PNG) and size (2 MB) and returns a 5-minute pre-signed PUT URL for key `applications/{id}/{docKey}`. `getStatus` requires ID + mobile match and returns only student-safe fields (no internal notes). `adminExport` must never include S3 keys or URLs.
5. **API Gateway** – Create an HTTP API, add the eight routes from the README, attach Lambda integrations, enable CORS for your CloudFront domain, deploy and copy the invoke URL.
6. **Cognito** – Create a user pool (no self sign-up), a group `admins`, an app client without secret, a hosted UI domain, and your admin users. Back in API Gateway, add a JWT authorizer (the pool issuer URL and client ID) to every `/admin/*` route and redeploy. In the Lambdas, also check the `admins` group claim.
7. **Frontend bucket** – Create a second private S3 bucket, upload the project files, and first set `MOCK_MODE:false` and `API_BASE_URL` in `assets/js/app.js`.
8. **CloudFront** – Create a distribution with the frontend bucket as origin using Origin Access Control, default root object `index.html`, redirect HTTP to HTTPS. Apply the generated bucket policy. Add the CloudFront domain to the API and document-bucket CORS settings.
9. **CloudWatch** – Set log group retention (e.g. 30 days) for each Lambda; create alarms on Lambda `Errors` and API `5xx`; build a small dashboard.
10. **Testing** – Submit an application with documents; confirm objects land privately in S3 and cannot be opened by direct URL; track status with ID + mobile; call an admin route without a token (expect 401) and with a Cognito token (expect 200); update a status and export the CSV; check CloudWatch logs.

Optional later: SES for email notifications (verify the sender identity first).

## Security hardening (do before go-live)
1. **CloudFront response headers policy** (CloudFront > Policies > Response headers > Create): `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://<api-id>.execute-api.<region>.amazonaws.com https://<docs-bucket>.s3.<region>.amazonaws.com; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`, plus `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`. Attach it to the distribution's default behaviour. (Self-host the fonts to remove the Google entries.)
2. **Admin access:** Cognito MFA required, self sign-up disabled, short token lifetimes, group check in each admin Lambda. Never ship the demo credentials.
3. **Uploads:** use a pre-signed POST with `content-length-range` 1–2097152 and a `Content-Type` condition; random object keys; re-check type server-side; S3 bucket policy denying `aws:SecureTransport = false`; optional GuardDuty Malware Protection for S3.
4. **Abuse control:** API Gateway throttling on every route, and an AWS WAF rate-based rule on `/applications` and `/applications/status` (stops ID/mobile guessing). Keep the "not found" reply identical for wrong ID or wrong mobile.
5. **Server-side validation** of every field with a schema; the browser checks are only for convenience.
6. **Data protection:** DynamoDB encryption and point-in-time recovery on; no personal data in CloudWatch logs; CloudTrail on; IAM roles scoped to exact ARNs; CORS limited to the CloudFront domain.
