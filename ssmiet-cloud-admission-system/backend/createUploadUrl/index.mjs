import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST,OPTIONS"
};
const allowedContentTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);

export const handler = async (event) => {
  if (event.requestContext?.http?.method === "OPTIONS") return { statusCode: 204, headers, body: "" };
  try {
    const input = JSON.parse(event.body || "{}");
    const applicationId = String(input.applicationId || "").trim();
    const documentType = String(input.documentType || "").trim();
    const contentType = String(input.contentType || "").toLowerCase();
    const fileSize = Number(input.fileSize || 0);
    if (!applicationId || !documentType || !allowedContentTypes.has(contentType) || !Number.isFinite(fileSize) || fileSize < 1 || fileSize > 2 * 1024 * 1024) {
      return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: "Use a PDF, JPG, or PNG file smaller than 2 MB." }) };
    }
    const application = await db.send(new GetCommand({ TableName: process.env.APPLICATIONS_TABLE, Key: { applicationId } }));
    if (!application.Item) return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: "Application not found." }) };

    const extension = contentType === "application/pdf" ? "pdf" : contentType === "image/png" ? "png" : "jpg";
    const documentId = randomUUID();
    const docKey = `applications/${applicationId}/${documentId}.${extension}`;
    const command = new PutObjectCommand({
      Bucket: process.env.DOCUMENTS_BUCKET,
      Key: docKey,
      ContentType: contentType,
      Metadata: { applicationid: applicationId, documenttype: documentType }
    });
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
    await db.send(new PutCommand({
      TableName: process.env.DOCUMENTS_TABLE,
      Item: { applicationId, docKey, documentId, documentType, contentType, fileSize, verificationStatus: "Pending", uploadStatus: "Upload URL Issued", createdAt: new Date().toISOString() }
    }));
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, documentId, docKey, uploadUrl, expiresIn: 300 }) };
  } catch (error) {
    console.error("createUploadUrl failed", { message: error.message });
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: "Unable to prepare document upload." }) };
  }
};
