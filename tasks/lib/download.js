var fs = require('fs'),
    Q = require('q'),
    tar = require('tar'),
    zlib = require('zlib'),
    path = require('path'),
    request = require('request'),
    ZIP = require('zip');


// Download and unzip/untar the node wekit files from aws
module.exports = function(grunt) {

    exports.downloadAndUnpack = function(plattform) {
        var downloadAndUnpackDone = Q.defer(),
            exists = false;

        grunt.file.mkdir(plattform.dest);
        plattform.filename = ((plattform.url.split('/')).slice(-1)[0]);

        // We Check if the files exist
        plattform.files.every(function(file) {
          exists = grunt.file.exists(plattform.dest, file);
          return exists;
        });

        // If it exists, we resolve and return
        if(exists) {
          downloadAndUnpackDone.resolve(plattform);
          return downloadAndUnpackDone.promise;
        }

        // Files do not exists, so we download them
        var downloadDone = exports.download(plattform.url, plattform.dest);
        downloadDone.done(function(data) {
            var extractDone, removeFromPath = false;
            // @TODO: We are using the very slow zip module because it
            // was very easy to patch in the unzip module to support
            // file permission for mac

            if(data.ext === 'zip') {
                removeFromPath = (plattform.type === 'win' ? plattform.filename.replace('.zip', '') : false);
                extractDone = exports.unzipFile(data.dest, plattform.dest, removeFromPath);
            } else {
                extractDone = exports.untarFile(data.dest, plattform.dest);
            }

            extractDone.done(function() {
                downloadAndUnpackDone.resolve(plattform);
            });

        });

        return downloadAndUnpackDone.promise;
    };

    exports.download = function(url, dest) {
        var downloadDone = Q.defer(),
            extention = (url.split('.')).slice(-1)[0],
            downloadPath = path.resolve(dest, (url.split('/')).slice(-1)[0]),
            destStream = fs.createWriteStream(downloadPath),
            downloadRequest = request(url);

        grunt.log.writeln('Downloading: ' + url);

        destStream.on('close', function() {
            downloadDone.resolve({dest: downloadPath, ext: extention});
        });

        destStream.on('error', function(error) {
            grunt.log.error(error);
            grunt.fail.warn('Download write failed.');
        });

        downloadRequest.on('error', function(error) {
            grunt.log.error(error);
            grunt.fail.warn('There was an error while downloading.');
        });

        downloadRequest.pipe(destStream);

        return downloadDone.promise;
    };

    exports.unzipFile = function(file, dest, removeFromPath) {
        var _zipReader = ZIP.Reader(fs.readFileSync(file)),
            unzipDone = Q.defer();

        grunt.log.writeln('Unzipping: ' + file);

        _zipReader.forEach(function(entry) {
            var mode = entry.getMode(),
                fileName = path.resolve(dest, entry.getName());

            if(removeFromPath) {
                fileName = path.normalize(fileName.replace(removeFromPath, ''));
            }

            // Log unpacking
            grunt.verbose.writeln('Unpacking ' + entry.getName() + ' --> ' + fileName);

            if (entry.isDirectory()) {
                grunt.file.mkdir(fileName, function(err) {
                    if (mode) {
                        fs.chmodSync(fileName, mode);
                    }
                });
            } else {
                fs.writeFileSync(fileName, entry.getData());
                if (mode) {
                    fs.chmodSync(fileName, mode);
                }
            }

        });

        // I know that this is blocking, the defered is just for consistency :)
        // And when node unzip supports permissions
        unzipDone.resolve();
        return unzipDone.promise;
    };

    exports.untarFile = function(file, dest) {
        var tarParser = tar.Parse(),
            untarDone = Q.defer(),
            tarFile = fs.createReadStream(file);

        grunt.log.writeln('Untaring: ' + file);

        tarFile.pipe(zlib.createGunzip()).pipe(tarParser).on('entry', function(entry) {
            var filename = entry.path.split('/').reverse()[0];

            // Log unpacking
            grunt.verbose.writeln('Unpacking ' + filename + ' --> ' + path.resolve(dest, filename));

            // We skip the folder
            if (entry.size !== 0) {
                entry.pipe(fs.createWriteStream(path.resolve(dest, filename)));
            }
        });

        // Resolve when done
        tarParser.on('end', untarDone.resolve);
        return untarDone.promise;
    };

    return exports;
};