import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, "..", "src", "assets");
const sourcePng = path.join(
	srcDir,
	"4aa483a986255912b80c24338a4e7f563d95eabd.png",
);

const sizes = [64, 96, 192, 512];

async function optimize() {
	// Generate WebP at each size
	for (const size of sizes) {
		try {
			await sharp(sourcePng)
				.resize(size, size, {
					fit: "contain",
					background: { r: 0, g: 0, b: 0, alpha: 0 },
				})
				.webp({ quality: 85 })
				.toFile(path.join(srcDir, `phoenix-logo-${size}.webp`));
			console.log(`Created phoenix-logo-${size}.webp`);
		} catch (err) {
			console.error(`Failed creating phoenix-logo-${size}.webp:`, err);
		}
	}

	// Generate small PNG fallback (192px for reasonable fallback quality)
	await sharp(sourcePng)
		.resize(192, 192, {
			fit: "contain",
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		})
		.png({ quality: 80, compressionLevel: 9 })
		.toFile(path.join(srcDir, "phoenix-logo-fallback.png"));
	console.log("Created phoenix-logo-fallback.png");
}

optimize().catch(console.error);
