#!/bin/sh
# Put a branch's build at adlib.live/testdj without touching the live site.
# Copies that branch's page, styles and scripts into public/testdj/; sounds, fonts and data
# are shared with the live site through rewrites in vercel.json.
#   sh scripts/testdj.sh fullbass
set -e
BR=${1:?branch}
rm -rf public/testdj && mkdir -p public/testdj
git archive "$BR" public/index.html public/css public/js | tar -x -C public/testdj --strip-components=1
sed -i 's#<head>#<head>\n<base href="/testdj/">#' public/testdj/index.html
echo "testdj now shows $BR ($(git rev-parse --short "$BR"))"
