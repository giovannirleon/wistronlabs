# Use official Node.js image
FROM node:20

# set timezone to Central Time (Chicago)
#ENV TZ=America/Chicago

# Set working directory
WORKDIR /usr/src/app

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install
RUN npm install -g nodemon

# Copy the rest of the app code
COPY . .

# Expose the port the app runs on
EXPOSE 3000

# Default command
CMD ["npm", "start"]

