/**
 * @NApiVersion 2.x
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/log', 'N/https', 'N/error', 'N/query'], 
    function(record, log, https, error, queryModule) {
        query = queryModule;

    /**
     * Function to obtain UPS API access token
     * @returns {string} Access token
     */
    function getUPSAccessToken() {
        // Replace 'YOUR_USERNAME' and 'YOUR_PASSWORD' with your UPS API credentials
        var username = 'YOUR_USERNAME';
        var password = 'YOUR_PASWORD';
        var merchantId = 'YOUR_MERCHATID';

        // Construct the request payload
        var formData = 'grant_type=client_credentials';

        // Make the HTTP request to obtain the access token
        var resp = https.post({
            url: 'https://onlinetools.ups.com/security/v1/oauth/token',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'x-merchant-id': merchantId,
                'Authorization': 'Basic ' + base64Encode(username + ':' + password)
            },
            body: formData
        });

        // Parse the response to extract the access token
        var data = JSON.parse(resp.body);

        if (data.error) {
            throw error.create({
                name: 'UPS_ACCESS_TOKEN_ERROR',
                message: 'Error obtaining UPS access token: ' + data.error_description
            });
        }

        // Log the obtained access token (optional)
        log.debug({
            title: 'UPS Access Token',
            details: data.access_token
        });

        return data.access_token;
    }

    /**
     * Function to validate an address with UPS
     * @param {Object} address - Address object
     * @param {string} accessToken - UPS API access token
     * @returns {Object} Validation result
     */
    function validateAddressWithUPS(address, accessToken) {
        // Construct the UPS Address Validation API request payload
        var requestOption = '3';
        var version = 'v1';

        var queryString = 'regionalrequestindicator=false&maximumcandidatelistsize=1';

        var requestBody = {
            XAVRequest: {
                AddressKeyFormat: address
            }
        };

        // Log UPS API request details
        log.debug({
            title: 'UPS API Request',
            details: requestBody
        });

        // Make the HTTP request to UPS API
        var resp = https.post({
            url: 'https://onlinetools.ups.com/api/addressvalidation/' + version + '/' + requestOption + '?' + queryString,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + accessToken
            },
            body: JSON.stringify(requestBody)
        });

        // Parse the UPS API response
        var responseBody = JSON.parse(resp.body);
        log.debug({
            title: 'Response',
            details: responseBody
        });

        // Validating Address
        if (
            responseBody.XAVResponse.Candidate.AddressKeyFormat.PostcodePrimaryLow !== address.PostcodePrimaryLow ||
            responseBody.XAVResponse.Candidate.AddressKeyFormat.PoliticalDivision2.toUpperCase() !== address.PoliticalDivision2.toUpperCase()
        ) {
            return {
                valid: false,
                errorMessage: "Based on the address given City or Zip Code is incorrect. Expected: " +
                    responseBody.XAVResponse.Candidate.AddressKeyFormat.PoliticalDivision2 + ", " +
                    responseBody.XAVResponse.Candidate.AddressKeyFormat.PostcodePrimaryLow + "-" +
                    responseBody.XAVResponse.Candidate.AddressKeyFormat.PostcodeExtendedLow
            };
        } else {
            // Check AddressClassification to determine if it's residential or commercial
            var classificationCode = responseBody.XAVResponse.Candidate.AddressClassification.Code;
            var classificationDescription = responseBody.XAVResponse.Candidate.AddressClassification.Description;

            // Add classification check
            if (classificationCode === '2') {
                // Residential address
                return {
                    valid: true,
                    classification: 'Residential',
                    errorMessage: ''
                };
            } else if (classificationCode === '1') {
                // Commercial address
                return {
                    valid: true,
                    classification: 'Commercial',
                    errorMessage: ''
                };
            } else {
                // Unknown classification
                return {
                    valid: true,
                    classification: 'Unknown',
                    errorMessage: ''
                };
            }

        }


    }

    /**
     * User Event Script main function (beforeSubmit)
     * @param {Object} context - User Event context
     */
    function afterSubmitAddressValidation(context) {
        log.debug({
            title: 'User Event - Before Submit',
            details: 'Before submit event started.'
        });

        try {
            // Get the new record being processed
            //var newRecord = context.newRecord;

            var newRecordId = context.newRecord.id;

            var newRecord = record.load({
                type: record.Type.SALES_ORDER,
                id: newRecordId,
                isDynamic: true // Set to true if you need to modify the record
            });

            var checkVerified = newRecord.getValue({
                fieldId: 'custbodyaddresserrorfield'
            });

            if ( checkVerified === 'Verified Address' || checkVerified === 'Addresses out of the US are not validated' || checkVerified === 'Address verified manually') {
                return;
            }

            // Get ship country
            var shipCountry = newRecord.getValue({
                fieldId: 'shipcountry'
            });

            // Log ship country
            log.debug({
                title: 'Ship Country',
                details: shipCountry
            });

            log.debug({
                title: 'New Record',
                details: newRecordId
            });

            // Check if shipcountry is not 'USA'
            if (shipCountry !== 'US') {
                // Log a message and end the script since address validation is only for the US
                log.debug({
                    title: 'Non-US Address',
                    details: 'Address validation is only applicable for US addresses. Exiting script.'
                });
                record.submitFields({
                    type: newRecord.type,
                    id: newRecordId,
                    values: {
                    custbodyaddresserrorfield: 'Addresses out of the US are not validated'
                    },
                    options: {
                        enableSourcing: false,
                        ignoreMandatoryFields: true
                    }
            });
                return;
            }

            // Check if Address Verified Checkbox is marked
            var verifiedCheckbox = newRecord.getValue({
                fieldId: 'custbodyneaaddressverified'
            });
            if (verifiedCheckbox === true) {
                // Log a message and end the script since address validation is only for the US
                log.debug({
                    title: 'Checkbox Checked',
                    details: 'Checkbox Checked. Exiting script.'
                });
                record.submitFields({
                    type: newRecord.type,
                    id: newRecordId,
                    values: {
                    custbodyaddresserrorfield: 'Address verified manually'
                    },
                    options: {
                        enableSourcing: false,
                        ignoreMandatoryFields: true
                    }
            });
                return;
                
            }

            // Get the UPS access token
            var accessToken = getUPSAccessToken();

            // Log a message with the obtained UPS access token
            log.debug({
                title: 'Obtained UPS Access Token',
                details: 'UPS access token: ' + accessToken
            });

            // Use a SQL query to get the Ship Address info
            var sql =
            "SELECT " +
            "   Transaction.ID, " +
            "   transactionShippingAddress.addressee AS shipaddressee, " +
            "   transactionShippingAddress.zip AS shipzip, " +
            "   transactionShippingAddress.addr1 AS shipaddress1, " +
            "   transactionShippingAddress.addr2 AS shipaddress2, " +
            "   transactionShippingAddress.city AS shipcity, " +
            "   transactionShippingAddress.attention AS shippingattention, " +
            "   transactionShippingAddress.country AS shipcountrycode, " +
            "   transactionShippingAddress.addrPhone AS shipphone, " +
            "   transactionShippingAddress.state AS shipstate " +
            "FROM " +
            "   Transaction " +
            "JOIN " +
            "   transactionShippingAddress ON Transaction.shippingaddress = transactionShippingAddress.nkey " +
            "WHERE " +
            "   Transaction.ID = " + newRecordId + ";";

            log.debug({
                title: 'SQL Search',
                details: sql
            });
        
            var queryParams = [];
            
            var rows = query.runSuiteQL( { query: sql, params: queryParams } ).asMappedResults();

            if (newRecord.getValue({ fieldId: 'shipzip' }).length === 5){
                // Construct address object from the Sales Order record
                var shipToAddress = {
                    AddressLine: [
                        rows[0].shipaddress1,
                    ],
                    Region: rows[0].shipcity + ',' + newRecord.getValue({ fieldId: 'shipstate' }) + ',' + newRecord.getValue({ fieldId: 'shipzip' }),
                    PoliticalDivision2: rows[0].shipcity,
                    PoliticalDivision1: newRecord.getValue({ fieldId: 'shipstate' }),
                    PostcodePrimaryLow: newRecord.getValue({ fieldId: 'shipzip' }),
                    CountryCode: newRecord.getValue({ fieldId: 'shipcountry' })
                };
            } else {
                // Construct address object from the Sales Order record
                var shipToAddress = {
                    AddressLine: [
                        rows[0].shipaddress1,
                    ],
                    Region: rows[0].shipcity + ',' + newRecord.getValue({ fieldId: 'shipstate' }) + ',' + newRecord.getValue({ fieldId: 'shipzip' }).slice(0,5),
                    PoliticalDivision2: rows[0].shipcity,
                    PoliticalDivision1: newRecord.getValue({ fieldId: 'shipstate' }),
                    PostcodePrimaryLow: newRecord.getValue({ fieldId: 'shipzip' }).slice(0,5),
                    PostcodeExtendedLow: newRecord.getValue({ fieldId: 'shipzip' }).slice(-4),
                    CountryCode: newRecord.getValue({ fieldId: 'shipcountry' })
                };
            };



            // Log shipToAddress details
            log.debug({
                title: 'Ship To Address',
                details: shipToAddress
            });

            // Call UPS Address Validation API
            var validationResult = validateAddressWithUPS(shipToAddress, accessToken);

            // Log validation result
            log.debug({
                title: 'Validation Result',
                details: validationResult
            });

            // Check the validation result
            if (!validationResult.valid) {
                // Address is invalid, update memo field with error message
                newRecord.setValue({
                    fieldId: 'custbodyaddresserrorfield',
                    value: 'Invalid address: ' + validationResult.errorMessage
                });

                record.submitFields({
                    type: newRecord.type,
                    id: newRecordId,
                    values: {
                        custbodyaddresserrorfield: 'Invalid address: ' + validationResult.errorMessage
                    },
                    options: {
                        enableSourcing: false,
                        ignoreMandatoryFields: true
                    }
                });

                // Log that the record was saved
                log.debug({
                    title: 'Record Saved',
                    details: 'Record saved with updated memo field.'
                });
            } else {
                // Address is valid, update memo field with error message
                newRecord.setValue({
                    fieldId: 'custbodyaddresserrorfield',
                    value: 'Verified Address'
                });

                if (validationResult.classification === 'Residential') {
                    log.debug({
                        title: 'Classification',
                        details: validationResult.classification
                    });
                /**
                record.submitFields({
                    type: newRecord.type,
                    id: newRecordId,
                    values: {
                        custbodyresidential_commercial: 2,
                        custbody_delivery_type: 1
                    },
                    options: {
                        enableSourcing: false,
                        ignoreMandatoryFields: true
                    }
                });*/
                
                } else if (validationResult.classification === 'Commercial') {
                    log.debug({
                        title: 'Classification',
                        details: validationResult.classification
                    });
                       /**             
                record.submitFields({
                    type: newRecord.type,
                    id: newRecordId,
                    values: {
                        custbodyresidential_commercial: 1,
                        custbody_delivery_type: 2
                    },
                    options: {
                        enableSourcing: false,
                        ignoreMandatoryFields: true
                    }
                });*/
                
                } else {
                    log.debug({
                        title: 'Classification',
                        details: validationResult.classification
                    });
                     /**               
                record.submitFields({
                    type: newRecord.type,
                    id: newRecordId,
                    values: {
                        custbodyresidential_commercial: 3,
                        custbody_delivery_type: 1
                    },
                    options: {
                        enableSourcing: false,
                        ignoreMandatoryFields: true
                    }
                });*/
                
                }

                record.submitFields({
                    type: newRecord.type,
                    id: newRecordId,
                    values: {
                        custbodyaddresserrorfield: 'Verified Address'
                    },
                    options: {
                        enableSourcing: false,
                        ignoreMandatoryFields: true
                    }
                });

                // Log that the record was saved
                log.debug({
                    title: 'Record Saved',
                    details: 'Record saved with updated memo field.'
                });                
            }

            log.debug({
                title: 'User Event - Before Submit',
                details: 'Before submit event completed.'
            });
        } catch (e) {
                    // Handle errors and update the memo field with an error message
            
            if (e.toString() === 'TypeError: Cannot read property "AddressKeyFormat" from undefined') {
                log.error({
                    title: 'Error during address validation',
                    details: e.toString()
                });
    
                newRecord.setValue({
                    fieldId: 'custbodyaddresserrorfield',
                    value: 'Given Address was not found on UPS database.'
                });
    
                record.submitFields({
                    type: newRecord.type,
                    id: newRecordId,
                    values: {
                    custbodyaddresserrorfield: 'Given Address was not found on UPS database.'
                    },
                    options: {
                        enableSourcing: false,
                        ignoreMandatoryFields: true
                    }
            });



            } else {
                log.error({
                    title: 'Error during address validation',
                    details: e.toString()
                });
    
                newRecord.setValue({
                    fieldId: 'custbodyaddresserrorfield',
                    value: 'ERROR ON THE ADDRESS VERIFICATION: ' + e.toString()
                });
    
                record.submitFields({
                    type: newRecord.type,
                    id: newRecordId,
                    values: {
                    custbodyaddresserrorfield: 'ERROR ON THE ADDRESS VERIFICATION: ' + e.toString()
                    },
                    options: {
                        enableSourcing: false,
                        ignoreMandatoryFields: true
                    }
            });
            }




        }
    }

    /**
     * Custom implementation of Base64 encoding
     * @param {string} str - String to be encoded
     * @returns {string} Base64 encoded string
     */
    function base64Encode(str) {
        var keyStr = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
        var output = "";
        var chr1, chr2, chr3, enc1, enc2, enc3, enc4;
        var i = 0;

        while (i < str.length) {
            chr1 = str.charCodeAt(i++);
            chr2 = str.charCodeAt(i++);
            chr3 = str.charCodeAt(i++);

            enc1 = chr1 >> 2;
            enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
            enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
            enc4 = chr3 & 63;

            if (isNaN(chr2)) {
                enc3 = enc4 = 64;
            } else if (isNaN(chr3)) {
                enc4 = 64;
            }

            output = output +
                keyStr.charAt(enc1) + keyStr.charAt(enc2) +
                keyStr.charAt(enc3) + keyStr.charAt(enc4);
        }

        return output;
    }

    return {
        afterSubmit: afterSubmitAddressValidation
    };

});
