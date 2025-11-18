// backend/scripts/cacheSharkImages.ts
import { supabaseAdmin } from "../src/lib/supabaseAdmin";
import fetch from "node-fetch";

async function main() {
  // 1) Get sharks that have meta.image but no image_url yet
  const { data: sharks, error } = await supabaseAdmin
    .from("sharks")
    .select("id, external_id, meta, image_url")
    .is("image_url", null);

  if (error) {
    console.error("Error loading sharks:", error);
    process.exit(1);
  }

  if (!sharks || sharks.length === 0) {
    console.log("No sharks without image_url. Nothing to do.");
    return;
  }

  console.log(`Found ${sharks.length} sharks to cache images for.`);

  for (const shark of sharks as any[]) {
    const meta = shark.meta || {};
    const sourceUrl: string | undefined = meta.image;

    if (!sourceUrl) {
      console.log(
        `Shark ${shark.id} (external ${shark.external_id}) has no meta.image, skipping.`
      );
      continue;
    }

    try {
      console.log(
        `Caching image for shark ${shark.id} (external ${shark.external_id}) from ${sourceUrl}`
      );

      // 2) Download the image from Mapotic
      const resp = await fetch(sourceUrl);
      if (!resp.ok) {
        console.error(
          `  Failed to download image: ${resp.status} ${resp.statusText}`
        );
        continue;
      }

      const arrayBuffer = await resp.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // 3) Upload to Supabase Storage (upsert)
      const ext = ".jpg"; // you can inspect resp.headers.get("content-type") to be smarter
      const path = `${shark.external_id}${ext}`;

      const { error: uploadError } = await supabaseAdmin.storage
        .from("shark-images")
        .upload(path, buffer, {
          upsert: true,
          contentType: resp.headers.get("content-type") ?? "image/jpeg",
        });

      if (uploadError) {
        console.error("  Upload error:", uploadError);
        continue;
      }

      // 4) Get public URL
      const {
        data: { publicUrl },
      } = supabaseAdmin.storage
        .from("shark-images")
        .getPublicUrl(path);

      // 5) Update sharks.image_url
      const { error: updateError } = await supabaseAdmin
        .from("sharks")
        .update({ image_url: publicUrl })
        .eq("id", shark.id);

      if (updateError) {
        console.error("  Failed to update image_url:", updateError);
        continue;
      }

      console.log(`  ✅ Cached and set image_url: ${publicUrl}`);
    } catch (err) {
      console.error("  Unexpected error:", err);
    }
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
