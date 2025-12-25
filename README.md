<div align="center">

# Love2D WebIDE

[![Hack Club Badge](https://img.shields.io/badge/Hack%20Club-EC3750?logo=Hack%20Club&logoColor=white)](https://flavortown.hackclub.com/projects/1403) ![Lua Badge](https://img.shields.io/badge/Lua-%232C2D72.svg?logo=lua&logoColor=white)


WebIDE for the Love2D game framework for Lua
</div>

***
Build and test Love2D projects entirely in your browser. Export with one click as a playable URL, HTML file, or `.love` file.

You can access it [here](https://love.ivie.codes/). We provide an [example project file](https://love.ivie.codes/example-project.json) if you want to test it out.

## Selfhosting

### Docker

We provide a docker-compose file for easy selfhosting. Simply run ``docker-compose up`` after cloning the repo.

### Manual
You can also selfhost manually

```bash
git clone https://github.com/Charmunks/loveweb
cd loveweb
cp example.env .env
npm i
npm run dev # or run start for prod
```

### .env Configuration

CDN and database configuration are only required for the sharable link functionality. None of the .env fields are required for base editor functionality

```bash
PORT=3000 # the port to run the server
POSTGRES_URL= # the connection url to the database
CDN_URL= # the url of the cdn used for storing game data
CDN_KEY= # api key for the cdn
```
