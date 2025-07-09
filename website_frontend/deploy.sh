#!/bin/bash

npm run build

cd dist || (echo "dist folder does not exits" && exit 1)
scp -r assets/ falab@tss.wistronlabs.com:/var/www/html
scp index.html falab@tss.wistronlabs.com:/var/www/html

cd .. || (echo "Failed to change directory" && exit 1)