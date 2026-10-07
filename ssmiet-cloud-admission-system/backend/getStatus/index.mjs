import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,OPTIONS"
};

export const handler = async (event) => {
  if (event.requestContext?.http?.method === "OPTIONS") return { statusCode: 204, headers, body: "" };
  const applicationId = String(event.queryStringParameters?.applicationId || "").trim();
  const mobile = String(event.queryStringParameters?.mobile || "").replace(/\D/g, "");
  if (!applicationId || !/^[6-9]\d{9}$/.test(mobile)) {
    return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: "Enter a valid application ID and mobile number." }) };
  }
  try {
    const result = await db.send(new GetCommand({ TableName: process.env.APPLICATIONS_TABLE, Key: { applicationId } }));
    if (!result.Item || result.Item.mobile !== mobile) {
      return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: "No matching application was found." }) };
    }
    const item = result.Item;
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        application: {
          applicationId: item.applicationId,
          fullName: item.fullName,
          courseName: item.courseName,
          status: item.status,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          studentVisibleMessage: item.studentVisibleMessage || ""
        }
      })
    };
  } catch (error) {
    console.error("getStatus failed", { message: error.message });
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: "Unable to check application status." }) };
  }
};
