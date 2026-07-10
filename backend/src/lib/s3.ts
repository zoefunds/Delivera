/** Tigris (S3-compatible) storage for deliverable attachments. */
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config.js";

export function storageConfigured(): boolean {
  return Boolean(config.S3_BUCKET && config.S3_ENDPOINT);
}

const s3 = new S3Client({
  region: "auto",
  endpoint: config.S3_ENDPOINT || undefined,
  forcePathStyle: false,
});

export async function uploadObject(key: string, body: Buffer, mime: string): Promise<void> {
  await s3.send(new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: key, Body: body, ContentType: mime }));
}

export async function signedDownloadUrl(key: string, ttlSec = 3600): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }), { expiresIn: ttlSec });
}
