/** @type {import('next').NextConfig} */
const nextConfig = {
  // standalone output is only needed for the Docker image (Vercel doesn't need it)
  output: process.env.NEXT_STANDALONE === "1" ? "standalone" : undefined,
  reactStrictMode: true,
};
export default nextConfig;
