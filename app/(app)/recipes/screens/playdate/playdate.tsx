import { PreSatori } from "@/utils/pre-satori";
import type { PlaydateData } from "./getData";

export default async function Playdate({
	imageUrl = "https://media-cdn.play.date/media/games/486467/website_feature_image_composite_6A68OUB.png",
	name = "ClayDate",
	width = 800,
	height = 480,
}: Partial<PlaydateData> & { width?: number; height?: number }) {
	return (
		<PreSatori width={width} height={height}>
			<div className="w-full h-full bg-black flex flex-col relative">
				{/* Full-bleed title card. getData pre-resizes the 1600x960 source to
				    the panel for an exact 1:2 downscale, so object-cover is 1:1. */}
				<picture className="w-full h-full absolute inset-0">
					{/* NOTE: Satori/Takumi do not support the Next.js Image component. */}
					<source srcSet={imageUrl} type="image/png" />
					<img
						src={imageUrl}
						alt={name}
						width={width}
						height={height}
						className="w-full h-full object-cover"
						style={{ imageRendering: "pixelated" }}
					/>
				</picture>
			</div>
		</PreSatori>
	);
}
