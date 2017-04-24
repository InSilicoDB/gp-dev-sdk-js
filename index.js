
const DeveloperAPIEndpoints = require('./endpoints');
const request = require('request-promise');

module.exports = function (baseURL, clientName, clientSecret) {

    var endpoints = new DeveloperAPIEndpoints(baseURL);

    return {

      getToken: function (authorisationCode, attributes) {
        if (typeof attributes==="undefined" || !attributes) {
          attributes = {
            grant_type: "authorization_code",
            code: authorisationCode,
            scope: "analysis"
          };
        }
        var requestOptions = {
          uri: endpoints.token,
          auth: {
            username: clientName,
            password: clientSecret
          },
          json: {
            data: {
              type: 'token',
              attributes: attributes
            }
          }
        };
        return request.post( requestOptions );
      },

      getAdminToken: function() {
        return this.getToken(null, {
          grant_type: "client_credentials",
          scope: "admin"
        });
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

      markAnalysis: function (accessToken, analysisId, state) {

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
                          status: state
                      }
                  }
              }
          };
          return request.patch( requestOptions );
      },

      markAnalysisAsFinished: function (accessToken, analysisId) {
        return this.markAnalysis(accessToken, analysisId, "ready");
      },

      markAnalysisAsError: function (accessToken, analysisId) {
        return this.markAnalysis(accessToken, analysisId, "error");
      },

      createDataset: function(accessToken, owner) {
        var requestOptions = {
          uri: endpoints.createDataset(),
          auth: {
            bearer: accessToken
          },
          json: {
            data: {
              type: 'dataset',
              attributes: {
                owner
              }
            }
          }
        };
        return request.post( requestOptions );
      },

      createLocalArchiveDatasetImport: function(accessToken, datasetId, archiveLocation, addToLoadingQueue) {
        var requestOptions = {
          uri: endpoints.createDatasetImport(datasetId),
          auth: {
            bearer: accessToken
          },
          json: {
            data:{
              type: "dataset",
              attributes:{
                addToLoadingQueue
                datasourceType: "local-archive",
                datasourceAttributes:{
                  location: archiveLocation
                }
              }
            }
          }
        };
        return request.post( requestOptions );
      }

    };
};
