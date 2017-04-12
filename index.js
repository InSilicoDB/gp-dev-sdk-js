
const DeveloperAPIEndpoints = require('./endpoints');
const request = require('request-promise');

module.exports = function (baseURL, clientName, clientSecret) {

    var endpoints = new DeveloperAPIEndpoints(baseURL);

    return {

        getToken: function (authorisationCode) {
            console.log('client = ' + clientName);
            console.log('password = ' + clientSecret);
            var requestOptions = {
                uri: endpoints.token,
                auth: {
                    username: clientName,
                    password: clientSecret
                },
                json: {
                    data: {
                        type: 'token',
                        attributes: {
                            grant_type: "authorization_code",
                            code: authorisationCode,
                            scope: "analysis"
                        }
                    }
                }
            };
            return request.post( requestOptions );
        },

        querySNPGenotypes: function (token, datasetId, snpNames, quality=0.80) {
            console.log('querySNPGenotypes()');
            var endpointLocation = endpoints.datasetSNPs(datasetId);
            var requestOptions = {
                uri: endpointLocation,
                json: true,
                auth: {
                    bearer: token
                },
                qs: {
                    names: snpNames.join(' '),
                    quality: quality
                }
            };
            return request.get( requestOptions );
        },

        addReportPage: function (accessToken, analysisId, title, content) {

            var requestOptions = {
                uri: endpoints.createReportPage(analysisId),
                auth: {
                    bearer: accessToken
                },
                json: {
                    data: {
                        type: 'page',
                        attributes: {
                            title: title,
                            content: content
                        }
                    }
                }
            };
            return request.post(requestOptions );
        },

        markAnalysisAsFinished: function (accessToken, analysisId) {

            var requestOptions = {
                uri: endpoints.updateAnalysisState(analysisId),
                auth: {
                    bearer: accessToken
                },
                json: {
                    data: {
                        type: 'analysis',
                        id: analysisId,
                        attributes: {
                            status: 'ready'
                        }
                    }
                }
            };
            request.patch( requestOptions );
        },

    };
};
