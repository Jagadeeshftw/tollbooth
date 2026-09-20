# Rendered cuts

The silent 150-second render, straight from `video/src`. It is the source the
narrated cut on YouTube was made from, kept here so the film can be re-cut
without re-deriving it.

It is deliberately **not** in `site/public`: the site points at the YouTube
video, which has a voice on it, and serving a second silent copy would only
cost visitors bandwidth for a worse version.

Rebuild with `npm run render` in `video/`.
