# SSM IET Lambda backend

Each directory contains one Node.js ES-module Lambda handler. Create a Lambda with the matching function name, paste its `index.mjs` code, and set the handler to `index.handler`.

## Required environment variables

Set these on every function that needs them:

```text
COURSES_TABLE=ssmiet-courses
APPLICATIONS_TABLE=ssmiet-applications
DOCUMENTS_TABLE=ssmiet-documents
HISTORY_TABLE=ssmiet-history
DOCUMENTS_BUCKET=your-private-document-bucket
ALLOWED_ORIGIN=http://localhost:8000
```

Use the actual CloudFront `https://...` URL in `ALLOWED_ORIGIN` before final deployment. The `admin*` functions expect API Gateway's Cognito JWT authorizer to supply an `admins` group claim.

## API routes

```text
GET    /courses                                      getCourses
POST   /applications                                 createApplication
GET    /applications/status                          getStatus
POST   /documents/upload-url                         createUploadUrl
GET    /admin/applications                           adminList
GET    /admin/applications/{applicationId}           adminGet
PATCH  /admin/applications/{applicationId}/status    adminUpdateStatus
GET    /admin/reports/export                         adminExport
```

The Lambda Node.js runtime includes AWS SDK v3. If the Lambda console reports a missing AWS SDK package, package the listed handler together with `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-s3`, and `@aws-sdk/s3-request-presigner` using a ZIP deployment package.
