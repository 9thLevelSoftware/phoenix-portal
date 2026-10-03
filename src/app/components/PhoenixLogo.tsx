import logo64 from "@/assets/phoenix-logo-64.webp";
import logo96 from "@/assets/phoenix-logo-96.webp";
import logoFallback from "@/assets/phoenix-logo-fallback.png";

const className = "w-8 h-8";

export function PhoenixLogo() {
	return (
		<div className={`${className} relative flex items-center justify-center`}>
			<picture>
				<source
					type="image/webp"
					srcSet={`${logo64} 64w, ${logo96} 96w`}
					sizes="32px"
				/>
				<img
					src={logoFallback}
					alt="Project Phoenix Logo"
					className={`${className} object-contain`}
					loading="lazy"
					decoding="async"
				/>
			</picture>
		</div>
	);
}
