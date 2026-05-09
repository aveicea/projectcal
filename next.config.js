/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: '/u/:cfg*',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors *" },
        ],
      },
    ];
  },
};
module.exports = nextConfig;
