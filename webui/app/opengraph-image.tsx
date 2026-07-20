import { readFile } from "node:fs/promises";
import { ImageResponse } from "next/og";

export const alt = "OpenFile — private chess review powered by your own Stockfish";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  const mark = await readFile(
    new URL("../public/brand/openfile-mark.png", import.meta.url),
  );
  const markUrl = `data:image/png;base64,${mark.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          overflow: "hidden",
          position: "relative",
          background: "#f7f6f2",
          color: "#1c1917",
          padding: "74px 82px",
        }}
      >
        <div
          style={{
            position: "absolute",
            right: "-120px",
            top: "-170px",
            width: "650px",
            height: "650px",
            display: "flex",
            borderRadius: "50%",
            background: "#a12222",
            opacity: 0.08,
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", width: "720px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              color: "#a12222",
              fontSize: 24,
              fontWeight: 800,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
            }}
          >
            Local-first chess improvement
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 22,
              fontSize: 92,
              lineHeight: 1,
              fontWeight: 900,
              letterSpacing: "-0.055em",
            }}
          >
            OpenFile
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 26,
              maxWidth: "690px",
              color: "#57534e",
              fontSize: 34,
              lineHeight: 1.35,
              fontWeight: 600,
            }}
          >
            Review your games, explore every position, and train from your own mistakes.
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 44,
              color: "#78716c",
              fontSize: 22,
              fontWeight: 600,
            }}
          >
            SQLite · Local Stockfish · Open source
          </div>
        </div>
        <div
          style={{
            width: 260,
            height: 260,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 58,
            background: "white",
            boxShadow: "0 24px 70px rgba(28, 25, 23, 0.14)",
            border: "1px solid #e7e5e4",
          }}
        >
          <img src={markUrl} alt="" width={210} height={210} />
        </div>
      </div>
    ),
    size,
  );
}
